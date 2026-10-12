#!/usr/bin/env bash
# Root-only redacted status publisher for the currently promoted DigitalOcean writer.
# It writes only enum health signals to the local private PostgreSQL container.
set -euo pipefail

fail() {
  printf 'promoted_writer_status_publish_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'publish_redacted_promoted_writer_status' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role

command -v docker >/dev/null 2>&1 || fail docker_missing

resolve_database_container() {
  local -a candidates=()
  # Match PostgreSQL itself, never the distinct postgres-meta sidecar.
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

db_container="$(resolve_database_container || true)"
[ -n "$db_container" ] || fail database_container_unresolved
auth_container='supabase-auth'
rest_container='supabase-rest'
storage_container='supabase-storage'
caddy_container='supabase-caddy'
edge_container='supabase-edge-functions'
storage_attestation='/var/lib/lemtel-ha/storage-sync-manifests/last-success'

container_health() {
  local name="$1"
  if docker inspect "$name" >/dev/null 2>&1 && [ "$(docker inspect --format '{{.State.Running}}' "$name")" = true ]; then
    printf healthy
  else
    printf degraded
  fi
}

runtime=healthy
for container in "$db_container" "$auth_container" "$rest_container" "$storage_container" "$caddy_container" "$edge_container"; do
  [ "$(container_health "$container")" = healthy ] || runtime=degraded
done

postgres=degraded
replication_database=unknown
standby=unknown
if [ "$(container_health "$db_container")" = healthy ]; then
  writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
  if [ "$writer_state" = false ]; then
    postgres=healthy
    replication_database="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_stat_replication WHERE state = '\''streaming'\'') THEN '\''streaming'\'' ELSE '\''unknown'\'' END"' 2>/dev/null || true)"
    if [ "$replication_database" = streaming ]; then standby=hostinger_streaming_standby; else replication_database=unknown; fi
  fi
fi

auth=degraded
if [ "$(container_health "$auth_container")" = healthy ]; then
  auth_url="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$auth_container" | sed -n 's/^API_EXTERNAL_URL=//p' | sed -n '1p')"
  case "$auth_url" in
    https://*) auth_http_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 15 "$auth_url/auth/v1/health" 2>/dev/null || true)" ;;
    *) auth_http_status='' ;;
  esac
  case "$auth_http_status" in 200|204|401|403) auth=healthy ;; esac
fi

storage_replication=unknown
if [ -r "$storage_attestation" ]; then
  storage_stamp="$(sed -n 's/^sync_timestamp_utc=//p' "$storage_attestation" | sed -n '1p')"
  if [[ "$storage_stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
    storage_epoch="$(date -u -d "$storage_stamp" +%s 2>/dev/null || true)"
    now_epoch="$(date -u +%s)"
    if [[ "$storage_epoch" =~ ^[0-9]+$ ]] && [ "$storage_epoch" -le "$now_epoch" ] && [ $((now_epoch - storage_epoch)) -le 900 ]; then
      storage_replication=integrity_verified
    else
      storage_replication=sync_attention
    fi
  fi
fi

rest="$(container_health "$rest_container")"
storage="$(container_health "$storage_container")"
overall=healthy
for state in "$runtime" "$postgres" "$auth" "$rest" "$storage"; do [ "$state" = healthy ] || overall=degraded; done
[ "$replication_database" = streaming ] && [ "$storage_replication" = integrity_verified ] || overall=degraded

checked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
payload="$(python3 - "$checked_at" "$overall" "$runtime" "$postgres" "$auth" "$rest" "$storage" "$standby" "$replication_database" "$storage_replication" <<'PY'
import json
import sys
observed_at, overall, runtime, database, auth, rest, storage, standby, database_replication, storage_replication = sys.argv[1:]
print(json.dumps({
  "version": "lemtel_operational_status_v1",
  "observed_at": observed_at,
  "overall": overall,
  "topology": {
    "writer": "digitalocean_promoted_writer",
    "standby": standby,
    "route": "canonical_digitalocean_live",
    "automatic_failover": False,
  },
  "services": {
    "runtime": runtime,
    "database": database,
    "auth": auth,
    "rest": rest,
    "storage": storage,
  },
  "replication": {
    "database": database_replication,
    "storage": storage_replication,
  },
}, separators=(",", ":")))
PY
)"

# The payload contains only the enum/timestamp contract above.
# psql quoting prevents an enum value from being interpreted as SQL.
docker exec -e "LEMTEL_OPERATIONAL_STATUS=$payload" "$db_container" sh -eu -c '
  export PSQLRC=/dev/null
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v "payload=$LEMTEL_OPERATIONAL_STATUS" <<'"'"'SQL'"'"'
INSERT INTO public.lemtel_operational_status (singleton, observed_at, overall_status, payload, updated_at)
VALUES (true, (:'"'"'payload'"'"'::jsonb ->> '"'"'observed_at'"'"')::timestamptz, :'"'"'payload'"'"'::jsonb ->> '"'"'overall'"'"', :'"'"'payload'"'"'::jsonb, now())
ON CONFLICT (singleton) DO UPDATE
SET observed_at = EXCLUDED.observed_at,
    overall_status = EXCLUDED.overall_status,
    payload = EXCLUDED.payload,
    updated_at = now();
SQL
' >/dev/null

printf 'promoted_writer_status_publish_status=complete\n'
printf 'overall_status=%s\n' "$overall"
printf 'redacted_snapshot_written=true\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_failover_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
