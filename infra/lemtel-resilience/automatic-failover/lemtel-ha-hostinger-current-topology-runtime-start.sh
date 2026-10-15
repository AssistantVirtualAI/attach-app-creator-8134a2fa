#!/usr/bin/env bash
# Root-only runtime activation after the current-topology Hostinger promotion.
# It does not promote a database, change Cloudflare/DNS, restart DO, or touch PBX/SIP.
set -euo pipefail
umask 077
fail() { printf 'hostinger_current_topology_runtime_start_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
secure_root_file() { [ -f "$1" ] && [ -O "$1" ] && [ "$(stat -c '%a' "$1")" = 600 ]; }
secure_root_dir() { [ -d "$1" ] && [ -O "$1" ] && [ "$(stat -c '%a' "$1")" = 700 ]; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = activate_current_topology_hostinger_runtime ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = hostinger_promoted_writer ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_CURRENT_TOPOLOGY_RUNTIME_START:-}" = I_UNDERSTAND_PROMOTED_HOSTINGER_RUNTIME_WILL_START ] || fail runtime_start_acknowledgement_required
incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
[[ "$incident_id" =~ ^[a-z0-9-]{8,80}$ ]] || fail invalid_incident_id
for command in docker flock grep stat ss; do command -v "$command" >/dev/null 2>&1 || fail "${command}_missing"; done
systemctl is-active --quiet docker || fail docker_inactive
state_dir=/var/lib/lemtel-ha/current-topology-evidence
secure_root_dir "$state_dir" || fail evidence_directory_missing_or_insecure
promotion_state="$state_dir/hostinger-promotion.state"
fence="$state_dir/do-writer-fence-receipt.state"
for file in "$promotion_state" "$fence"; do secure_root_file "$file" || fail required_evidence_missing_or_insecure; done
grep -Fxq 'format=lemtel_do_writer_fence_receipt_v1' "$fence" || fail do_writer_fence_format_invalid
grep -Fxq 'receipt_hmac_verified=true' "$fence" || fail do_writer_fence_hmac_not_verified
grep -Fxq "incident_id=$incident_id" "$fence" || fail do_writer_fence_incident_mismatch
grep -Fxq 'writer_role=do_writer' "$fence" || fail do_writer_fence_role_invalid
grep -Fxq 'terminal_action_status=completed' "$fence" || fail do_writer_fence_not_terminal
grep -Fxq 'terminal_power_state=off' "$fence" || fail do_writer_not_fenced
grep -Eq '^confirmations=[2-9][0-9]*$' "$fence" || fail do_writer_fence_confirmations_invalid
grep -Fxq 'format=lemtel_hostinger_current_topology_promotion_v1' "$promotion_state" || fail promotion_state_format_invalid
grep -Fxq "incident_id=$incident_id" "$promotion_state" || fail promotion_state_incident_mismatch
grep -Fxq 'writer_role=hostinger_promoted_writer' "$promotion_state" || fail promotion_state_role_invalid
grep -Fxq 'promotion_executed=true' "$promotion_state" || fail promotion_not_confirmed
container="$(sed -n 's/^container=//p' "$promotion_state")"
[[ "$container" =~ ^[A-Za-z0-9_.-]+$ ]] || fail promotion_container_invalid
stage_dir=/opt/lemtel-ha/runtime-stage
storage_receiver=/home/lemtelstorage/storage-current
storage_mount="$stage_dir/volumes/storage"
network=lemtel-ha-hostinger-promoted_default
lock_file=/var/lock/lemtel-ha-hostinger-current-topology-runtime.lock
[ -d "$stage_dir" ] || fail runtime_stage_missing
[ -d "$storage_receiver" ] || fail standby_storage_receiver_missing
[ -f "$storage_receiver/.lemtel-ha-manifest.current.sha256" ] || fail standby_storage_manifest_missing
docker inspect "$container" >/dev/null 2>&1 || fail promoted_database_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail promoted_database_not_running
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx f || fail promoted_database_still_recovering
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail promoted_database_published_port
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
compose=(docker compose --project-name lemtel-ha-hostinger-promoted --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml)
cd "$stage_dir"
expected='api-gw,auth,caddy,db,functions,imgproxy,meta,realtime,rest,storage,studio,supavisor'
actual="$("${compose[@]}" config --services | sort | paste -sd, -)"
[ "$actual" = "$expected" ] || fail runtime_service_inventory_mismatch
mapfile -t existing < <(docker ps --format '{{.Names}}' --filter label=com.docker.compose.project=lemtel-ha-hostinger-promoted)
[ "${#existing[@]}" -eq 0 ] || fail promoted_runtime_already_exists
[ ! -e "$storage_mount" ] || fail runtime_storage_mount_already_exists
docker network inspect "$network" >/dev/null 2>&1 && fail runtime_network_already_exists
exec 9>"$lock_file"; flock -n 9 || fail concurrent_runtime_start
network_created=false; database_connected=false; storage_link=false; runtime_attempted=false
cleanup() { status=$?; if [ "$status" -ne 0 ]; then
  if [ "$runtime_attempted" = true ]; then "${compose[@]}" stop >/dev/null 2>&1 || true; "${compose[@]}" rm --force --stop >/dev/null 2>&1 || true; fi
  [ "$database_connected" = true ] && docker network disconnect "$network" "$container" >/dev/null 2>&1 || true
  [ "$network_created" = true ] && docker network rm "$network" >/dev/null 2>&1 || true
  [ "$storage_link" = true ] && rm -f "$storage_mount"
fi; return "$status"; }
trap cleanup EXIT
docker network create --driver bridge --label com.docker.compose.network=default --label com.docker.compose.project=lemtel-ha-hostinger-promoted "$network" >/dev/null; network_created=true
docker network connect --alias db "$network" "$container"; database_connected=true
ln -s "$storage_receiver" "$storage_mount"; storage_link=true
services=(api-gw auth functions imgproxy meta realtime rest storage studio supavisor caddy)
runtime_attempted=true
"${compose[@]}" up --detach --force-recreate --no-build --no-deps "${services[@]}" >/dev/null
for service in "${services[@]}"; do id="$("${compose[@]}" ps --quiet "$service")"; [ -n "$id" ] || fail "runtime_service_missing_${service}"; [ "$(docker inspect --format '{{.State.Running}}' "$id")" = true ] || fail "runtime_service_not_running_${service}"; done
caddy_id="$("${compose[@]}" ps --quiet caddy)"; docker port "$caddy_id" | grep -q . || fail runtime_public_listener_missing
[ -z "$(docker port "$container" 2>/dev/null || true)" ] || fail promoted_database_published_port
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
printf 'hostinger_current_topology_runtime_start_format=lemtel_hostinger_current_topology_runtime_start_v1\n'
printf 'writer=hostinger_promoted_writer\nincident_id_matched=true\ndo_writer_fence_receipt_hmac_verified=true\npromoted_database_writer_verified=true\nstandby_runtime_started=true\npublic_runtime_listener_enabled=true\npublic_database_listener_enabled=false\ndns_change_executed=false\nautomatic_traffic_routing_enabled=false\ntelephony_contacted=false\ncredential_values_emitted=false\nhostinger_current_topology_runtime_start_status=complete\n'
