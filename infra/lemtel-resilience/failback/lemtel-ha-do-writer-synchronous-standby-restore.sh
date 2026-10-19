#!/usr/bin/env bash
# FAILBACK step 6 — on the DigitalOcean writer, once Hostinger streams again as a standby (step 5).
# Restores the normal topology: synchronous replication FIRST 1 (lemtel_hostinger_standby), so no committed
# transaction exists only on DigitalOcean. Refuses unless the Hostinger standby is streaming right now
# (otherwise every write would block).
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'do_synchronous_standby_restore_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = restore_do_synchronous_hostinger_standby ] || fail execution_token_required
container='lemtel-postgres-standby'
# Supabase images: the role "postgres" is NOT a superuser (no CHECKPOINT, pg_promote, ALTER SYSTEM, pg_hba_file_rules).
# The cluster superuser is supabase_admin, trusted on the container loopback. The session is chosen and PROVEN superuser
# before any change; a plain socket session is kept only when that role really is superuser.
su_args=()
pick_superuser() {
  if [ "$(docker exec -u postgres -e PGCONNECT_TIMEOUT=5 "$container" psql -X -At -d postgres -h 127.0.0.1 -U supabase_admin -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)" = t ]; then
    su_args=(-h 127.0.0.1 -U supabase_admin); return 0
  fi
  [ "$(docker exec -u postgres -e PGCONNECT_TIMEOUT=5 "$container" psql -X -At -d postgres -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)" = t ] && { su_args=(); return 0; }
  return 1
}
psql() { docker exec -u postgres "$container" psql -X -At -d postgres ${su_args[@]+"${su_args[@]}"} -v ON_ERROR_STOP=1 -c "$1"; }
pick_superuser || fail superuser_session_unavailable
[ "$(psql 'SELECT pg_is_in_recovery()')" = f ] || fail do_not_writer
[ "$(psql "SELECT count(*) FROM pg_stat_replication WHERE application_name = 'lemtel_hostinger_standby' AND state = 'streaming'")" = 1 ] \
  || fail hostinger_standby_not_streaming
psql "ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (lemtel_hostinger_standby)'" >/dev/null
psql 'SELECT pg_reload_conf()' >/dev/null
state=''
for _ in $(seq 1 15); do
  state="$(psql "SELECT sync_state FROM pg_stat_replication WHERE application_name = 'lemtel_hostinger_standby'" || true)"
  [ "$state" = sync ] && break
  sleep 2
done
if [ "$state" != sync ]; then
  # Never leave writes blocked on a standby that is not synchronous.
  psql "ALTER SYSTEM SET synchronous_standby_names = ''" >/dev/null; psql 'SELECT pg_reload_conf()' >/dev/null
  fail hostinger_not_synchronous_reverted_to_async
fi
printf 'do_synchronous_standby_restore_format=lemtel_do_synchronous_standby_restore_v1\n'
printf 'synchronous_standby_names=FIRST 1 (lemtel_hostinger_standby)\nhostinger_sync_state=sync\ndo_synchronous_standby_restore_status=complete\n'
