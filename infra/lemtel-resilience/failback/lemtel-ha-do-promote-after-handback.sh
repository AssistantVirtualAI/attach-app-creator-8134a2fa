#!/usr/bin/env bash
# FAILBACK step 4 — on DigitalOcean, after Hostinger was quiesced AND fenced (step 3).
#   replay-lsn : prints the standby's replayed WAL position (used by the operator to fence Hostinger).
#   promote    : refuses unless DigitalOcean is a streaming-or-caught-up standby that replayed at least
#                LEMTEL_HA_HOSTINGER_FINAL_LSN and Hostinger no longer accepts a database login; then promotes
#                DigitalOcean, keeps writes non-blocking (synchronous standby restored later, step 6),
#                lifts the boot fence, restarts the relay and the Lemtel runtime, and attests the writer marker.
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'do_promote_after_handback_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"
case "$mode" in replay-lsn|promote) ;; *) fail usage_replay_lsn_or_promote ;; esac
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required

container='lemtel-postgres-standby'
image='supabase/postgres:17.6.1.136'
project='lemtel-ha-standby'
hostinger_tunnel='10.253.47.1'
fence_tool="$T/usr/local/sbin/lemtel-ha-do-writer-boot-fence"
probe_host='lemtel-do-l7.assistantvirtualai.com'
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
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail database_not_running
pick_superuser || fail superuser_session_unavailable

if [ "$mode" = replay-lsn ]; then
  [ "$(psql 'SELECT pg_is_in_recovery()')" = t ] || fail not_a_standby
  printf 'replayed_lsn=%s\n' "$(psql 'SELECT pg_last_wal_replay_lsn()')"
  exit 0
fi

[ "${LEMTEL_HA_EXECUTE:-}" = promote_do_after_hostinger_handback ] || fail execution_token_required
final="${LEMTEL_HA_HOSTINGER_FINAL_LSN:-}"
[[ "$final" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || fail hostinger_final_lsn_required
[ "$(psql 'SELECT pg_is_in_recovery()')" = t ] || fail not_a_standby
[ "$(psql "SELECT pg_wal_lsn_diff(pg_last_wal_replay_lsn(), '$final') >= 0")" = t ] || fail standby_has_not_replayed_hostinger_final_lsn
# Hostinger must be fenced: no database login possible any more (relay removed and database stopped).
pgpass="$(docker exec -u postgres "$container" sh -c 'test -f /var/lib/postgresql/data/lemtel-ha-replication.pgpass && echo present' || true)"
[ "$pgpass" = present ] || fail standby_pgpass_missing
if docker exec -u postgres -e PGPASSFILE=/var/lib/postgresql/data/lemtel-ha-replication.pgpass -e PGCONNECT_TIMEOUT=5 "$container" \
     psql -X -At -h "$hostinger_tunnel" -U lemtel_ha_replication -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  fail hostinger_still_accepts_logins_fence_it_first
fi

psql 'SELECT pg_promote(true, 60)' | grep -qx t || fail promotion_failed
[ "$(psql 'SELECT pg_is_in_recovery()')" = f ] || fail promotion_not_confirmed
# Hostinger is not a standby yet: never block writes on it until step 6 rebuilds it.
psql "ALTER SYSTEM SET synchronous_standby_names = ''" >/dev/null
psql 'SELECT pg_reload_conf()' >/dev/null
# DigitalOcean is the only writer again: lift the boot fence (it re-checks that Hostinger serves no marker).
[ -x "$fence_tool" ] || fail boot_fence_tool_missing
LEMTEL_BF_UNFENCE_ACK=I_CONFIRM_DO_IS_THE_ONLY_WRITER "$fence_tool" unfence >/dev/null || fail boot_fence_unfence_refused
systemctl restart lemtel-ha-do-postgres-wireguard-relay.service >/dev/null 2>&1 || true
mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project")
[ "${#ids[@]}" -gt 0 ] || fail runtime_containers_missing
docker start "${ids[@]}" >/dev/null
systemctl start lemtel-ha-do-writer-lb-ready.service >/dev/null 2>&1 || true
code=000
for _ in $(seq 1 24); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 8 --resolve "$probe_host:443:127.0.0.1" "https://$probe_host/lemtel-lb-ready" || true)"
  [ "$code" = 200 ] && break
  systemctl start lemtel-ha-do-writer-lb-ready.service >/dev/null 2>&1 || true
  sleep 5
done
[ "$code" = 200 ] || fail writer_marker_not_served

printf 'do_promote_after_handback_format=lemtel_do_promote_after_handback_v1\n'
printf 'do_writer=true\nreplayed_hostinger_final_lsn=%s\nhostinger_logins_refused=true\nsynchronous_standby=pending_step_6\n' "$final"
printf 'boot_fence=lifted\nruntime_started=true\nwriter_marker_http=200\ndo_promote_after_handback_status=complete\n'
