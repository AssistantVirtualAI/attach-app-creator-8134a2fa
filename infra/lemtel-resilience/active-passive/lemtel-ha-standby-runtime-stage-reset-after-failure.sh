#!/usr/bin/env bash
# Root-only cleanup of a failed, inactive standby runtime stage before restaging a corrected encrypted envelope.
set -euo pipefail

fail() {
  printf 'standby_runtime_stage_reset_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'reset_failed_standby_runtime_stage' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_RUNTIME_STAGE_RESET:-}" = 'I_UNDERSTAND_ONLY_FAILED_RUNTIME_CONFIGURATION_WILL_BE_REMOVED' ] || fail reset_acknowledgement_required

base_dir='/opt/lemtel-ha'
stage_dir="$base_dir/runtime-stage"
network='lemtel-ha-standby_default'
postgres_container='lemtel-postgres-standby'
storage_mount="$stage_dir/volumes/storage"

command -v docker >/dev/null 2>&1 || fail docker_missing
docker inspect "$postgres_container" >/dev/null 2>&1 || fail promoted_database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true ] || fail promoted_database_not_running
if docker port "$postgres_container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

running="$(docker ps --format '{{.Names}}' | sort | paste -sd, -)"
[ "$running" = "$postgres_container" ] || fail runtime_containers_still_running
mapfile -t stopped_runtime_ids < <(docker ps --all --quiet --filter "label=com.docker.compose.project=lemtel-ha-standby")
for container_id in "${stopped_runtime_ids[@]}"; do
  container_name="$(docker inspect --format '{{.Name}}' "$container_id" | sed 's#^/##')"
  [ "$container_name" != "$postgres_container" ] || fail promoted_database_labeled_as_runtime
  [ "$(docker inspect --format '{{.State.Running}}' "$container_id")" = false ] || fail runtime_containers_still_running
  docker rm "$container_id" >/dev/null
done
if docker network inspect "$network" >/dev/null 2>&1; then
  remaining_endpoints="$(docker network inspect --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' "$network")"
  [ -z "$remaining_endpoints" ] || fail runtime_network_unexpected_endpoint
  docker network rm "$network" >/dev/null
fi
[ ! -e "$storage_mount" ] || fail runtime_storage_link_still_present
[ -d "$stage_dir" ] || fail runtime_stage_missing

rm -rf -- "$stage_dir"
[ ! -e "$stage_dir" ] || fail runtime_stage_removal_failed

printf 'standby_runtime_stage_reset_format=lemtel_standby_runtime_stage_reset_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'failed_runtime_containment_verified=true\n'
printf 'promoted_database_preserved=true\n'
printf 'runtime_configuration_removed=true\n'
printf 'runtime_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_runtime_stage_reset_status=complete\n'
