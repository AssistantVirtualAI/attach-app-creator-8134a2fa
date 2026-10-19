#!/usr/bin/env bash
# FAILBACK step 3 — on the promoted Hostinger writer, the planned hand-back to DigitalOcean.
#   quiesce : stops the promoted runtime and its readiness marker (no more writes, the Load Balancer stops
#             sending traffic here), checkpoints, and prints the final WAL position (final_lsn=...).
#             The database keeps running so the DigitalOcean standby can catch up to that exact position.
#   fence   : after DigitalOcean has replayed final_lsn: stops the Hostinger database for good
#             (restart policy "no"), removes the failback relay, writes a fence state. Only then may DO be promoted.
# Never touches DNS, Cloudflare or DigitalOcean.
set -euo pipefail
umask 077
T="${LEMTEL_FB_TEST_ROOT:-}"   # test hook only
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
fail() { printf 'hostinger_writer_handback_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"
case "$mode" in quiesce|fence) ;; *) fail usage_quiesce_or_fence ;; esac
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = hand_back_hostinger_writer_to_digitalocean ] || fail execution_token_required

container='lemtel-postgres-hostinger-standby'
project='lemtel-ha-hostinger-promoted'
stage="$T/opt/lemtel-ha/runtime-stage"
marker="$stage/volumes/proxy/caddy/lemtel-lb-ready.json"
state_dir="$T/var/lib/lemtel-ha/failback"
psql() { docker exec -u postgres "$container" psql -X -At -d postgres -v ON_ERROR_STOP=1 -c "$1"; }
docker inspect "$container" >/dev/null 2>&1 || fail database_container_missing
install -d -m 0700 "$state_dir"

if [ "$mode" = quiesce ]; then
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail database_not_running
  [ "$(psql 'SELECT pg_is_in_recovery()')" = f ] || fail hostinger_not_writer
  # The DigitalOcean standby must already be streaming from us, otherwise the hand-back would lose data.
  [ "$(psql "SELECT count(*) FROM pg_stat_replication WHERE application_name = 'lemtel_do_standby' AND state = 'streaming'")" = 1 ] \
    || fail do_standby_not_streaming_run_step_2
  systemctl stop lemtel-ha-hostinger-lb-ready.timer lemtel-ha-hostinger-lb-ready.service >/dev/null 2>&1 || true
  rm -f -- "$marker" "${marker%.json}"
  mapfile -t ids < <(docker ps -q --filter "label=com.docker.compose.project=$project")
  [ "${#ids[@]}" -eq 0 ] || docker stop --time 30 "${ids[@]}" >/dev/null
  [ -z "$(docker ps -q --filter "label=com.docker.compose.project=$project")" ] || fail promoted_runtime_still_running
  # No client may still be writing (the runtime is stopped); terminate stray sessions except replication.
  psql "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()" >/dev/null
  psql 'CHECKPOINT' >/dev/null
  lsn="$(psql 'SELECT pg_current_wal_lsn()')"
  [[ "$lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || fail wal_position_invalid
  printf 'quiesced_at_utc=%s\nfinal_lsn=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$lsn" > "$state_dir/quiesced"
  printf 'hostinger_writer_handback_format=lemtel_hostinger_writer_handback_v1\n'
  printf 'promoted_runtime_stopped=true\nreadiness_marker=removed\nfinal_lsn=%s\nhostinger_writer_handback_status=complete\n' "$lsn"
  exit 0
fi

# fence
[ -f "$state_dir/quiesced" ] || fail quiesce_first
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$project")" ] || fail promoted_runtime_still_running
expected="${LEMTEL_HA_DO_REPLAYED_LSN:-}"
[[ "$expected" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || fail do_replayed_lsn_required
if [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; then
  current="$(psql 'SELECT pg_current_wal_lsn()')"
  # DigitalOcean must have replayed everything Hostinger ever wrote.
  [ "$(psql "SELECT pg_wal_lsn_diff('$expected', '$current') >= 0")" = t ] || fail do_standby_behind_hostinger
fi
docker update --restart=no "$container" >/dev/null
docker stop --time 60 "$container" >/dev/null 2>&1 || true
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail database_still_running
relay="$(dirname "$0")/lemtel-ha-hostinger-writer-replication-enable.sh"
if [ -f "$relay" ]; then bash "$relay" remove >/dev/null || fail relay_removal_failed; else
  systemctl disable --now lemtel-ha-hostinger-postgres-wireguard-relay.service >/dev/null 2>&1 || true; fi
printf 'fenced_at_utc=%s\ndo_replayed_lsn=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$expected" > "$state_dir/fenced"
printf 'hostinger_writer_handback_format=lemtel_hostinger_writer_handback_v1\n'
printf 'hostinger_database_stopped=true\nrestart_policy=no\nrelay_removed=true\nhostinger_writer_handback_status=complete\n'
