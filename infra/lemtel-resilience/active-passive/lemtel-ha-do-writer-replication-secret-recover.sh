#!/usr/bin/env bash
# Root-only recovery for an orphaned, unused physical replication role on the
# promoted DigitalOcean writer. This is deliberately separate from normal
# standby preparation because a previous role password cannot be reconstructed.
set -euo pipefail

fail() {
  printf 'do_writer_replication_secret_recovery_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'recover_orphaned_do_writer_replication_secret' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

age_recipient="${LEMTEL_HA_STANDBY_AGE_RECIPIENT:-}"
db_container='lemtel-postgres-standby'
replication_role='lemtel_ha_replication'
replication_slot='lemtel_hostinger_standby'
secret_dir='/etc/lemtel-ha/secrets'
secret_file="$secret_dir/postgres-replication-hostinger.password"
envelope_dir='/home/lemtelops/.lemtel-ha'
envelope_file="$envelope_dir/replication-password-hostinger.age"
lock_file='/run/lock/lemtel-ha-do-writer-replication-secret-recover.lock'
sql_file=''
completed=false

query_database() {
  local query="$1"
  docker exec -u postgres "$db_container" psql -X -At -F '|' -d postgres -c "$query"
}

cleanup() {
  local status=$?
  rm -f "$sql_file"
  if [ "$status" -ne 0 ] && [ "$completed" = false ]; then
    printf 'do_writer_replication_secret_recovery_rollback_not_applicable=true\n' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

case "$age_recipient" in age1[0-9a-z]*) ;; *) fail invalid_standby_age_recipient ;; esac
command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
command -v openssl >/dev/null 2>&1 || fail openssl_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
systemctl is-active --quiet lemtel-ha-do-postgres-wireguard-relay.service || fail private_postgres_relay_inactive
printf '' | age -r "$age_recipient" -o /dev/null || fail invalid_standby_age_recipient

docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.Config.Image}}' "$db_container")" = 'supabase/postgres:17.6.1.136' ] || fail unexpected_database_image
docker inspect --format '{{.State.Running}}' "$db_container" | grep -qx true || fail database_not_running
[ -f "$secret_file" ] && fail local_replication_secret_already_present
[ -f "$envelope_file" ] && fail encrypted_replication_envelope_already_present

exec 9>"$lock_file"
flock -n 9 || fail concurrent_replication_secret_recovery

# psql already uses `|` as its field delimiter. Keep each role attribute in
# a distinct SQL column so a valid `true|true` role cannot be split into two
# unrelated shell fields and mistaken for an unsafe role state.
state="$(query_database "SELECT pg_is_in_recovery(), COALESCE((SELECT rolcanlogin::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false'), COALESCE((SELECT rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false'), (SELECT count(*) FROM pg_stat_replication), (SELECT count(*) FROM pg_stat_activity WHERE usename = '${replication_role}'), COALESCE((SELECT CASE WHEN active THEN 'active' ELSE 'inactive' END FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), 'absent'), COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), 'absent')")"
IFS='|' read -r recovery role_can_login role_can_replicate active_replicas role_sessions slot_active slot_kind <<< "$state"
[ "$recovery" = f ] || fail writer_in_recovery
[ "$role_can_login" = true ] && [ "$role_can_replicate" = true ] || fail replication_role_not_orphaned
[ "$active_replicas" = 0 ] || fail active_replication_present
[ "$role_sessions" = 0 ] || fail replication_role_session_present
case "$slot_active:$slot_kind" in absent:absent|inactive:physical) ;; *) fail replication_slot_active_or_invalid ;; esac

install -d -m 0700 "$secret_dir" "$envelope_dir"
umask 077
openssl rand -hex 32 > "$secret_file"
chmod 0600 "$secret_file"
password="$(cat "$secret_file")"
sql_file="$(mktemp /root/lemtel-ha-replication-recovery.XXXXXX.sql)"
chmod 0600 "$sql_file"
printf "ALTER ROLE %s WITH LOGIN REPLICATION PASSWORD '%s';\n" "$replication_role" "$password" > "$sql_file"
docker cp "$sql_file" "${db_container}:/tmp/lemtel-ha-replication-recovery.sql"
docker exec -u 0 "$db_container" sh -eu -c 'chown postgres:postgres /tmp/lemtel-ha-replication-recovery.sql; chmod 0600 /tmp/lemtel-ha-replication-recovery.sql'
docker exec -u postgres "$db_container" sh -eu -c 'psql -X -v ON_ERROR_STOP=1 -d postgres -f /tmp/lemtel-ha-replication-recovery.sql >/dev/null; rm -f /tmp/lemtel-ha-replication-recovery.sql'
unset password
age -r "$age_recipient" -o "$envelope_file" "$secret_file"
chmod 0600 "$envelope_file"
chown lemtelops:lemtelops "$envelope_file"
[ "$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")" = 'true|true' ] || fail recovered_replication_role_postcondition

printf 'do_writer_replication_secret_recovery_format=lemtel_do_writer_replication_secret_recovery_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'orphaned_role_confirmed=true\n'
printf 'active_replication_confirmed=false\n'
printf 'replication_role_session_confirmed=false\n'
printf 'existing_slot_active=false\n'
printf 'replication_secret_rotated=true\n'
printf 'replication_secret_envelope_created=true\n'
printf 'plaintext_secret_replication=false\n'
printf 'database_public_listener_enabled=false\n'
printf 'runtime_changed=false\n'
printf 'storage_changed=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_replication_secret_recovery_status=complete\n'
completed=true
