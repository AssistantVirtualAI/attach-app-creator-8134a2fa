#!/usr/bin/env bash
# Root-only recovery for an aborted drill before any standby promotion or DNS cutover.
# Never run this after DigitalOcean has been promoted; rebuild Hostinger as a standby instead.
set -euo pipefail

fail() {
  printf 'primary_fence_abort_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'abort_primary_fence_before_standby_promotion' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role
[ "${LEMTEL_HA_ABORT_BEFORE_PROMOTION:-}" = 'I_CONFIRM_NO_STANDBY_PROMOTION_OR_DNS_CUTOVER_OCCURRED' ] || fail abort_acknowledgement_required

container='supabase-db'
state_file='/var/lib/lemtel-ha/fencing/primary-fence.state'
lock_file='/var/lock/lemtel-ha-primary-fence.lock'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
[ -s "$state_file" ] || fail fencing_state_missing
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing

exec 9>"$lock_file"
flock -n 9 || fail concurrent_fencing_operation

format="$(sed -n 's/^format=//p' "$state_file")"
recorded_container="$(sed -n 's/^container=//p' "$state_file")"
original_restart_policy="$(sed -n 's/^original_restart_policy=//p' "$state_file")"
[ "$format" = lemtel_primary_fence_v1 ] || fail fencing_state_invalid
[ "$recorded_container" = "$container" ] || fail fencing_state_container_invalid
case "$original_restart_policy" in
  no|always|unless-stopped|on-failure) ;;
  *) fail fencing_state_restart_policy_invalid ;;
esac
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail database_container_not_fenced
[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container")" = no ] || fail database_restart_policy_not_fenced

docker update --restart "$original_restart_policy" "$container" >/dev/null
docker start "$container" >/dev/null

for attempt in $(seq 1 24); do
  if docker exec -u postgres "$container" pg_isready -q -d postgres; then
    rm -f "$state_file"
    printf 'primary_fence_abort_format=lemtel_primary_fence_abort_v1\n'
    printf 'declared_role=hostinger_primary\n'
    printf 'abort_before_standby_promotion=true\n'
    printf 'primary_database_running=true\n'
    printf 'original_restart_policy_restored=true\n'
    printf 'fencing_state_removed=true\n'
    printf 'standby_promotion_executed=false\n'
    printf 'dns_change_executed=false\n'
    printf 'automatic_promotion_enabled=false\n'
    printf 'fusionpbx_or_sip_contacted=false\n'
    printf 'credential_values_emitted=false\n'
    printf 'primary_fence_abort_status=complete\n'
    exit 0
  fi
  sleep 5
done

printf 'primary_fence_abort_status=primary_database_not_ready_after_restore\n' >&2
exit 1
