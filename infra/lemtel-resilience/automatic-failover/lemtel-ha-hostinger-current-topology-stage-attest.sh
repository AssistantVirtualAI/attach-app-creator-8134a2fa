#!/usr/bin/env bash
# Root-only, local readiness attestation for the staged Hostinger runtime.
# It creates only a root-owned evidence file; it never starts runtime, promotes,
# fences, changes Cloudflare/DNS, or contacts a telephony service.
set -euo pipefail
umask 077
fail() { printf 'hostinger_current_topology_stage_attest_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
resolve_standby_postgres() {
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = attest_current_topology_hostinger_runtime_stage ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = hostinger_private_hot_standby ] || fail invalid_role
incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
[[ "$incident_id" =~ ^[a-z0-9-]{8,80}$ ]] || fail invalid_incident_id
# check: every verification, no evidence written (continuous standby readiness, before any incident).
attest_mode="${LEMTEL_HA_ATTEST_MODE:-record}"
case "$attest_mode" in record|check) ;; *) fail invalid_attest_mode ;; esac
for command in docker sha256sum flock ss date; do command -v "$command" >/dev/null 2>&1 || fail "${command}_missing"; done
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
state_dir=/var/lib/lemtel-ha/current-topology-evidence
state_file="$state_dir/hostinger-runtime-stage.state"
artifact_dir=/var/lib/lemtel-ha/artifacts/hostinger-received
current_digest_file="$artifact_dir/current.sha256"
stage_dir=/opt/lemtel-ha/runtime-stage
storage_receiver=/home/lemtelstorage/storage-current
lock_file=/var/lock/lemtel-ha-hostinger-current-topology-stage-attest.lock
[ -d "$stage_dir" ] || fail runtime_stage_missing
[ -d "$storage_receiver" ] || fail standby_storage_receiver_missing
[ -f "$storage_receiver/.lemtel-ha-manifest.current.sha256" ] || fail standby_storage_manifest_missing
[ -s "$current_digest_file" ] || fail runtime_envelope_digest_missing
digest="$(tr -d '[:space:]' < "$current_digest_file")"
[[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail runtime_envelope_digest_invalid
[ -f "$artifact_dir/$digest.tgz" ] || fail runtime_envelope_missing
[ "$(sha256sum "$artifact_dir/$digest.tgz" | awk '{print $1}')" = "$digest" ] || fail runtime_envelope_digest_mismatch
container="$(resolve_standby_postgres || true)"
[ -n "$container" ] || fail standby_postgres_unresolved
docker inspect "$container" >/dev/null 2>&1 || fail standby_postgres_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail standby_postgres_not_running
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail standby_postgres_port_published
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx t || fail standby_not_in_recovery
compose=(docker compose --project-name lemtel-ha-hostinger-promoted --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml)
(
  cd "$stage_dir"
  "${compose[@]}" config >/dev/null
)
if docker ps --filter label=com.docker.compose.project=lemtel-ha-hostinger-promoted --format '{{.Names}}' | grep -q .; then fail standby_runtime_already_running; fi
exec 9>"$lock_file"; flock -n 9 || fail concurrent_stage_attestation
if [ "$attest_mode" = check ]; then
  printf 'hostinger_current_topology_stage_attest_format=lemtel_hostinger_runtime_stage_v1\nattest_mode=check\nevidence_written=false\nhostinger_current_topology_stage_attest_status=complete\n'
  exit 0
fi
install -d -o root -g root -m 0700 "$state_dir"
tmp="$(mktemp "$state_dir/.hostinger-runtime-stage.XXXXXX")"
printf 'format=lemtel_hostinger_runtime_stage_v1\nincident_id=%s\nrole=hostinger_private_hot_standby\ncontainer=%s\nruntime_envelope_digest=%s\nruntime_staged=true\nruntime_running=false\nstandby_in_recovery=true\npublic_database_listener_enabled=false\nattested_at_utc=%s\n' \
  "$incident_id" "$container" "$digest" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$state_file"
printf 'hostinger_current_topology_stage_attest_format=lemtel_hostinger_runtime_stage_v1\n'
printf 'runtime_stage_compose_verified=true\nruntime_envelope_digest_verified=true\nstandby_in_recovery=true\npublic_database_listener_enabled=false\nruntime_started=false\ndns_change_executed=false\nautomatic_traffic_routing_enabled=false\ntelephony_contacted=false\ncredential_values_emitted=false\nhostinger_current_topology_stage_attest_status=complete\n'
