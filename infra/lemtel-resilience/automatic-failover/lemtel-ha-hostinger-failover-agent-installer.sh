#!/usr/bin/env bash
# Lemtel-only, root-only installer for the prepared Hostinger failover agent.
# It validates a private, stopped standby and installs disabled unit files only.
set +x
set -euo pipefail
umask 077

readonly INSTALL_TOKEN='install_hostinger_failover_agent_disabled'
readonly STANDBY_ROLE='hostinger_standby'
readonly RUNTIME_PROJECT='lemtel-ha-hostinger-promoted'
readonly STORAGE_ATTESTATION='/home/lemtelstorage/storage-current/.lemtel-ha-manifest.current.sha256'
readonly STORAGE_MAX_AGE_SECONDS=900
readonly TARGET_DIR='/opt/lemtel-ha/automatic-failover'
readonly STATE_DIR='/var/lib/lemtel-ha/failover-agent'
readonly LEDGER_FILE="$STATE_DIR/installer-ledger"
readonly SYSTEMD_DIR='/etc/systemd/system'
readonly SERVICE_UNIT='lemtel-ha-hostinger-failover-agent.service'
readonly TIMER_UNIT='lemtel-ha-hostinger-failover-agent.timer'

fail() {
  printf 'hostinger_failover_agent_installer_status=blocked\nreason=%s\n' "$1" >&2
  exit 78
}

require_binary() {
  command -v "$1" >/dev/null 2>&1 || fail "${1}_missing"
}

require_root_safe_chain() {
  local path="$1" current='/' part mode
  [ "${path#/}" != "$path" ] || fail invalid_absolute_path
  IFS='/' read -r -a parts <<< "${path#/}"
  for part in "${parts[@]}"; do
    [ -n "$part" ] || continue
    current="${current%/}/$part"
    [ -d "$current" ] && [ ! -L "$current" ] || fail local_path_not_directory
    [ "$(stat -c '%u:%g' -- "$current")" = '0:0' ] || fail local_path_not_root_owned
    mode="$(stat -c '%a' -- "$current")"
    (( (8#$mode & 8#022) == 0 )) || fail local_path_group_or_world_writable
  done
}

prepare_root_directory() {
  local path="$1" requested_mode="$2" expected_mode parent
  parent="$(dirname -- "$path")"
  require_root_safe_chain "$parent"
  if [ -e "$path" ] || [ -L "$path" ]; then
    [ -d "$path" ] && [ ! -L "$path" ] || fail local_path_not_directory
  fi
  install -d -o root -g root -m "$requested_mode" -- "$path"
  expected_mode="${requested_mode#0}"
  [ "$(stat -c '%u:%g:%a' -- "$path")" = "0:0:$expected_mode" ] || fail local_directory_permissions_invalid
}

assert_unit_inactive_and_disabled() {
  local unit="$1" active_state enabled_state
  active_state="$(systemctl is-active "$unit" 2>/dev/null || true)"
  case "$active_state" in
    active|activating|reloading) fail "${unit%.service}_already_active" ;;
  esac
  enabled_state="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  case "$enabled_state" in
    enabled|enabled-runtime|linked|linked-runtime|alias|indirect) fail "${unit%.service}_already_enabled" ;;
  esac
}

resolve_standby_postgres() {
  mapfile -t standby_candidates < <(
    docker ps --format '{{.Names}}|{{.Image}}' |
      awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }'
  )
  [ "${#standby_candidates[@]}" -eq 1 ] || fail standby_postgres_unresolved
  printf '%s' "${standby_candidates[0]}"
}

assert_standby_is_private_and_streaming() {
  local container="$1" recovery receiver published
  docker inspect "$container" >/dev/null 2>&1 || fail standby_postgres_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail standby_postgres_not_running
  published="$(docker port "$container" 2>/dev/null || true)"
  [ -z "$published" ] || fail standby_postgres_port_published
  if ss -H -ltn 'sport = :5432' | grep -q .; then
    fail host_postgres_listener_detected
  fi
  recovery="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')" || fail standby_recovery_query_failed
  [ "$recovery" = t ] || fail standby_not_in_recovery
  receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')" || fail standby_streaming_query_failed
  [ "$receiver" = streaming ] || fail standby_not_streaming
}

assert_fresh_storage_attestation() {
  local observed_epoch now age
  [ -f "$STORAGE_ATTESTATION" ] && [ ! -L "$STORAGE_ATTESTATION" ] && [ -s "$STORAGE_ATTESTATION" ] || fail storage_attestation_missing
  observed_epoch="$(stat -c '%Y' -- "$STORAGE_ATTESTATION")" || fail storage_attestation_unreadable
  now="$(date +%s)"
  [[ "$observed_epoch" =~ ^[0-9]+$ && "$now" =~ ^[0-9]+$ ]] || fail storage_attestation_clock_invalid
  age=$((now - observed_epoch))
  [ "$age" -ge 0 ] || fail storage_attestation_clock_invalid
  [ "$age" -le "$STORAGE_MAX_AGE_SECONDS" ] || fail storage_attestation_stale
}

write_durable_ledger() {
  local temporary
  prepare_root_directory '/var/lib/lemtel-ha' '0700'
  prepare_root_directory "$STATE_DIR" '0700'
  if [ -e "$LEDGER_FILE" ] || [ -L "$LEDGER_FILE" ]; then
    [ -f "$LEDGER_FILE" ] && [ ! -L "$LEDGER_FILE" ] || fail installer_ledger_type_invalid
    [ "$(stat -c '%u:%g:%a' -- "$LEDGER_FILE")" = '0:0:600' ] || fail installer_ledger_permissions_invalid
  fi
  temporary="$(mktemp "$STATE_DIR/.installer-ledger.XXXXXX")"
  trap 'rm -f -- "$temporary"' EXIT
  printf 'format=lemtel_hostinger_failover_agent_installer_v1\ninstalled_at_utc=%s\nrole=hostinger_standby\nservice_enabled=false\ntimer_enabled=false\nruntime_started=false\npromotion_executed=false\nfencing_executed=false\nrouting_changed=false\ntelephony_contacted=false\nbusiness_data_modified=false\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$temporary"
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$LEDGER_FILE"
  trap - EXIT
  sync -f "$LEDGER_FILE" "$STATE_DIR"
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = "$INSTALL_TOKEN" ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = "$STANDBY_ROLE" ] || fail invalid_role

for binary in awk date docker grep install mktemp ss stat sync systemctl; do
  require_binary "$binary"
done
systemctl is-active --quiet docker || fail docker_inactive
assert_unit_inactive_and_disabled "$SERVICE_UNIT"
assert_unit_inactive_and_disabled "$TIMER_UNIT"
if docker ps --filter "label=com.docker.compose.project=$RUNTIME_PROJECT" --format '{{.Names}}' | grep -q .; then
  fail hostinger_runtime_already_running
fi
standby_container="$(resolve_standby_postgres)"
assert_standby_is_private_and_streaming "$standby_container"
assert_fresh_storage_attestation

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_files=(
  lemtel-ha-hostinger-failover-agent.sh
  lemtel-ha-hostinger-current-topology-stage-attest.sh
  lemtel-ha-hostinger-current-topology-promote.sh
  lemtel-ha-hostinger-current-topology-runtime-start.sh
  lemtel-ha-hostinger-failover-agent.service
  lemtel-ha-hostinger-failover-agent.timer
)
for source_file in "${source_files[@]}"; do
  [ -f "$source_dir/$source_file" ] && [ ! -L "$source_dir/$source_file" ] || fail package_source_missing_or_unsafe
done

prepare_root_directory '/opt/lemtel-ha' '0750'
prepare_root_directory "$TARGET_DIR" '0750'
for source_file in "${source_files[@]:0:4}"; do
  install -o root -g root -m 0750 -- "$source_dir/$source_file" "$TARGET_DIR/$source_file"
done
install -o root -g root -m 0644 -- "$source_dir/$SERVICE_UNIT" "$SYSTEMD_DIR/$SERVICE_UNIT"
install -o root -g root -m 0644 -- "$source_dir/$TIMER_UNIT" "$SYSTEMD_DIR/$TIMER_UNIT"
systemctl daemon-reload
assert_unit_inactive_and_disabled "$SERVICE_UNIT"
assert_unit_inactive_and_disabled "$TIMER_UNIT"
write_durable_ledger

printf 'hostinger_failover_agent_installer_format=lemtel_hostinger_failover_agent_installer_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'standby_in_recovery=true\n'
printf 'standby_wal_receiver_streaming=true\n'
printf 'public_database_listener_enabled=false\n'
printf 'storage_attestation_fresh=true\n'
printf 'agent_service_enabled=false\n'
printf 'agent_timer_enabled=false\n'
printf 'runtime_started=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'telephony_contacted=false\n'
printf 'business_data_modified=false\n'
printf 'installer_ledger_durable=true\n'
printf 'hostinger_failover_agent_installer_status=complete\n'
