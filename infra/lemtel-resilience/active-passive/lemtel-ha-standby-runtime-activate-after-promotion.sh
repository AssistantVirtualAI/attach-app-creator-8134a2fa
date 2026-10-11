#!/usr/bin/env bash
# Root-only startup of the staged Supabase runtime after a separately fenced PostgreSQL promotion.
# It is a one-way recovery action: it never changes DNS or starts the former primary.
set -euo pipefail

fail() {
  printf 'standby_runtime_activation_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'activate_promoted_standby_runtime' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_RUNTIME_ACTIVATION:-}" = 'I_UNDERSTAND_PROMOTED_STANDBY_RUNTIME_WILL_START' ] || fail runtime_activation_acknowledgement_required

incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
case "$incident_id" in ''|*[!a-z0-9-]*) fail invalid_incident_id ;; esac
[ "${#incident_id}" -ge 8 ] || fail invalid_incident_id

base_dir='/opt/lemtel-ha'
stage_dir="$base_dir/runtime-stage"
promotion_state='/var/lib/lemtel-ha/fencing/standby-promotion.state'
postgres_container='lemtel-postgres-standby'
storage_receiver_dir='/home/lemtelstorage/storage-current'
storage_mount="$stage_dir/volumes/storage"
network='lemtel-ha-standby_default'
lock_file='/var/lock/lemtel-ha-standby-runtime-activation.lock'
expected_services='api-gw,auth,caddy,db,functions,imgproxy,meta,realtime,rest,storage,studio,supavisor'
app_services=(api-gw auth functions imgproxy meta realtime rest storage studio supavisor caddy)

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
systemctl is-active --quiet docker || fail docker_inactive
[ -d "$stage_dir" ] || fail runtime_stage_missing
[ -s "$promotion_state" ] || fail standby_promotion_state_missing
[ -d "$storage_receiver_dir" ] || fail standby_storage_receiver_missing
[ -s "$storage_receiver_dir/.lemtel-ha-manifest.current.sha256" ] || fail standby_storage_manifest_missing

grep -Fxq 'format=lemtel_standby_promotion_v1' "$promotion_state" || fail standby_promotion_state_invalid
grep -Fxq "incident_id=$incident_id" "$promotion_state" || fail standby_promotion_incident_mismatch
grep -Fxq 'standby_in_recovery=false' "$promotion_state" || fail standby_promotion_not_confirmed
grep -Fxq 'primary_writer_reachable=false' "$promotion_state" || fail primary_fence_not_confirmed

docker inspect "$postgres_container" >/dev/null 2>&1 || fail promoted_database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true ] || fail promoted_database_not_running
docker exec -u postgres "$postgres_container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx f || fail promoted_database_still_recovering
if docker port "$postgres_container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

compose=(docker compose --project-name lemtel-ha-standby --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml)
cd "$stage_dir"
actual_services="$("${compose[@]}" config --services | sort | paste -sd, -)"
[ "$actual_services" = "$expected_services" ] || fail runtime_service_inventory_mismatch

existing_runtime="$(docker ps --format '{{.Names}}' | grep -v -Fx "$postgres_container" || true)"
[ -z "$existing_runtime" ] || fail unexpected_runtime_container
[ ! -e "$storage_mount" ] || fail runtime_storage_mount_already_exists
docker network inspect "$network" >/dev/null 2>&1 && fail runtime_network_already_exists

exec 9>"$lock_file"
flock -n 9 || fail concurrent_runtime_activation

network_created=false
database_connected=false
storage_link_created=false
runtime_start_attempted=false
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ "$runtime_start_attempted" = true ]; then
      "${compose[@]}" stop "${app_services[@]}" >/dev/null 2>&1 || true
    fi
    if [ "$database_connected" = true ]; then
      docker network disconnect "$network" "$postgres_container" >/dev/null 2>&1 || true
    fi
    if [ "$network_created" = true ]; then
      docker network rm "$network" >/dev/null 2>&1 || true
    fi
    if [ "$storage_link_created" = true ]; then
      rm -f "$storage_mount"
    fi
  fi
  return "$status"
}
trap cleanup EXIT

# Compose will manage application services on this labelled network while the promoted database
# remains a separately managed, unexposed container. Alias `db` preserves the Compose contract.
docker network create --driver bridge \
  --label com.docker.compose.network=default \
  --label com.docker.compose.project=lemtel-ha-standby \
  "$network" >/dev/null
network_created=true
docker network connect --alias db "$network" "$postgres_container"
database_connected=true
ln -s "$storage_receiver_dir" "$storage_mount"
storage_link_created=true

runtime_start_attempted=true
"${compose[@]}" up --detach --no-build --no-deps "${app_services[@]}" >/dev/null
for service in "${app_services[@]}"; do
  service_id="$("${compose[@]}" ps --quiet "$service")"
  [ -n "$service_id" ] || fail "runtime_service_missing_${service}"
  [ "$(docker inspect --format '{{.State.Running}}' "$service_id")" = true ] || fail "runtime_service_not_running_${service}"
done

caddy_id="$("${compose[@]}" ps --quiet caddy)"
docker port "$caddy_id" | grep -q . || fail runtime_public_listener_missing
if docker port "$postgres_container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

printf 'standby_runtime_activation_format=lemtel_standby_runtime_activation_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'incident_id_matched=true\n'
printf 'primary_fence_evidence_verified=true\n'
printf 'promoted_database_writer_verified=true\n'
printf 'standby_runtime_started=true\n'
printf 'storage_runtime_started=true\n'
printf 'public_runtime_listener_enabled=true\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'former_primary_restart_attempted=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_runtime_activation_status=complete\n'
