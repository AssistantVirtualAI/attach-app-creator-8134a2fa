#!/usr/bin/env bash
# Root-only emergency fencing of the active PostgreSQL writer.
# This intentionally stops only the primary database container and is never automatic.
set -euo pipefail

fail() {
  printf 'primary_fence_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'fence_primary_for_controlled_failover' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_PRIMARY_FENCE:-}" = 'I_UNDERSTAND_PRIMARY_WRITES_WILL_STOP' ] || fail fencing_acknowledgement_required

container='supabase-db'
state_dir='/var/lib/lemtel-ha/fencing'
state_file="$state_dir/primary-fence.state"
lock_file='/var/lock/lemtel-ha-primary-fence.lock'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
command -v ss >/dev/null 2>&1 || fail ss_missing
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail database_container_not_running

exec 9>"$lock_file"
flock -n 9 || fail concurrent_fencing_operation

install -d -o root -g root -m 0700 "$state_dir"
[ ! -e "$state_file" ] || fail existing_fencing_state_detected

original_restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container")"
case "$original_restart_policy" in
  no|always|unless-stopped|on-failure) ;;
  *) fail unsupported_restart_policy ;;
esac

rollback_armed=true
rollback() {
  if [ "${rollback_armed:-false}" = true ]; then
    docker update --restart "$original_restart_policy" "$container" >/dev/null 2>&1 || true
    docker start "$container" >/dev/null 2>&1 || true
    rm -f "$state_file"
  fi
}
trap rollback ERR INT TERM

umask 077
printf 'format=lemtel_primary_fence_v1\noriginal_restart_policy=%s\ncontainer=%s\nfenced_at_utc=%s\n' \
  "$original_restart_policy" "$container" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$state_file"
chmod 0600 "$state_file"

docker update --restart no "$container" >/dev/null
docker stop --time 30 "$container" >/dev/null

[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail primary_database_still_running
[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container")" = no ] || fail primary_restart_policy_not_fenced
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

rollback_armed=false
trap - ERR INT TERM

printf 'primary_fence_format=lemtel_primary_fence_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'primary_database_container=supabase-db\n'
printf 'primary_writer_fenced=true\n'
printf 'primary_database_running=false\n'
printf 'primary_database_restart_policy=no\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'fencing_state_recorded=true\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_change_executed=false\n'
printf 'client_cutover_executed=false\n'
printf 'standby_promotion_executed=false\n'
printf 'storage_runtime_started=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_fence_status=complete\n'
