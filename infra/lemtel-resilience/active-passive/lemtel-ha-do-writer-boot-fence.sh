#!/usr/bin/env bash
# DO writer boot fence. After an automatic failover the arbiter powers DO off; if DO is powered on again
# (by hand, by mistake or by provider maintenance) its containers restart and the old readiness marker is
# still on disk: the Load Balancer, which prefers DO, would send clients back to a stale writer and the
# Storage copy would overwrite the promoted Hostinger. This guard prevents that.
#   boot-clear : (before Docker) always removes the readiness marker.
#   decide     : (after Docker) confirms writer authority for THIS boot only when the Hostinger standby is
#                streaming from DO again, or (after a bounded wait) when the arbiter shows no incident and
#                Hostinger is not serving as promoted writer. Otherwise DO stays fenced: Lemtel containers
#                are stopped and a persistent fence state is written. The readiness marker and Storage copy
#                only run while /run/lemtel-ha/writer-authority-confirmed exists (systemd conditions).
#   unfence    : explicit operator step during a planned failback.
#   status     : read-only.
set -euo pipefail
umask 077
T="${LEMTEL_BF_TEST_ROOT:-}"   # test hook only (fixtures and fake tools on PATH)
[ -n "$T" ] || PATH=/usr/sbin:/usr/bin:/sbin:/bin
STATE_DIR="$T/var/lib/lemtel-ha/boot-fence"
FENCED="$STATE_DIR/fenced"
RUN_DIR="$T/run/lemtel-ha"
CONFIRMED="$RUN_DIR/writer-authority-confirmed"
CADDY_DIR="$T/opt/lemtel-ha/runtime-stage/volumes/proxy/caddy"
PROJECT='lemtel-ha-standby'
HOST='lemtel.assistantvirtualai.com'
HOSTINGER_ORIGIN="${LEMTEL_BF_HOSTINGER_ORIGIN:-72.60.125.253}"
ARBITER_STATUS="${LEMTEL_BF_ARBITER_STATUS_URL:-https://lemtel-failover-arbiter.mhassoun.workers.dev/status}"
WAIT_SECONDS="${LEMTEL_BF_WAIT_SECONDS:-600}"
STEP_SECONDS="${LEMTEL_BF_STEP_SECONDS:-10}"
say() { printf '%s\n' "$*"; }
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || { say 'boot_fence_status=failed'; say 'reason=root_required'; exit 1; }

clear_marker() { rm -f -- "$CADDY_DIR/lemtel-lb-ready.json" "$CADDY_DIR/lemtel-lb-ready"; }
hostinger_promoted() {
  curl -sk --max-time 8 --resolve "$HOST:443:$HOSTINGER_ORIGIN" "https://$HOST/lemtel-lb-ready" 2>/dev/null | grep -q '"writer_role":"hostinger_writer"'
}
arbiter_state() { # prints: incident | quiet | unknown
  local body state reason
  body="$(curl -s --max-time 8 "$ARBITER_STATUS" 2>/dev/null || true)"
  state="$(printf '%s' "$body" | sed -n 's/.*"state":"\([a-z_]*\)".*/\1/p')"
  reason="$(printf '%s' "$body" | sed -n 's/.*"reason":"\([a-z_]*\)".*/\1/p')"
  case "$state" in
    fence_*|promotion_command_ready|manual_promotion_action_required) echo incident ;;
    blocked) case "$reason" in
        fence_request_outcome_unknown_manual_review|terminal_power_state_timeout|provider_terminal_state_ambiguous|\
        terminal_power_state_changed|hard_fence_failed|fence_receipt_prerequisites_missing|\
        persisted_fence_intent_requires_manual_reconciliation|promotion_command_expired|promotion_command_invalid|\
        promotion_command_expired_or_configuration_changed|command_delivery_unknown_manual_review|\
        command_dispatched_to_agent|serializer_incident_refused|serializer_lease_expired) echo incident ;;
        *) echo quiet ;;
      esac ;;
    disabled_or_dry_run|healthy|observation|cycle_not_due|incident_suspected|bootstrap) echo quiet ;;
    *) echo unknown ;;
  esac
}
standby_streaming_from_do() {
  local db
  db="$(docker ps --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /supabase\/postgres(:|$)/ {print $1}' | head -1)"
  [ -n "$db" ] || return 1
  [ "$(docker exec "$db" sh -c 'export PSQLRC=/dev/null; psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_stat_replication WHERE application_name = '\''lemtel_hostinger_standby'\'' AND state = '\''streaming'\''"' 2>/dev/null)" = 1 ]
}
fence() {
  install -d -m 0700 "$STATE_DIR" "$RUN_DIR"
  rm -f -- "$CONFIRMED"; clear_marker
  printf 'fenced_at_utc=%s\nreason=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$FENCED.tmp"; mv -f -- "$FENCED.tmp" "$FENCED"
  mapfile -t ids < <(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
  [ "${#ids[@]}" -eq 0 ] || docker stop "${ids[@]}" >/dev/null
  say "boot_fence=fenced"; say "reason=$1"; say "lemtel_containers_stopped=${#ids[@]}"
  say 'readiness_marker=removed'; say 'storage_copy=blocked'; say 'boot_fence_status=complete'
}
confirm() {
  install -d -m 0755 "$RUN_DIR"; : > "$CONFIRMED"
  say "boot_fence=writer_authority_confirmed"; say "evidence=$1"; say 'boot_fence_status=complete'
}

case "${1:-}" in
  boot-clear) clear_marker; rm -f -- "$CONFIRMED"; say 'readiness_marker=removed_at_boot' ;;
  decide)
    clear_marker
    [ ! -e "$FENCED" ] || { fence persisted_fence_state_requires_operator_unfence; exit 0; }
    waited=0
    while :; do
      if hostinger_promoted; then fence hostinger_serving_as_promoted_writer; exit 0; fi
      if [ "$(arbiter_state)" = incident ]; then fence arbiter_incident_or_promotion_in_progress; exit 0; fi
      if standby_streaming_from_do; then confirm hostinger_standby_streaming_from_do; exit 0; fi
      [ "$waited" -lt "$WAIT_SECONDS" ] || break
      sleep "$STEP_SECONDS"; waited=$((waited + STEP_SECONDS))
    done
    if [ "$(arbiter_state)" = quiet ]; then confirm standby_unavailable_arbiter_quiet_hostinger_not_promoted; exit 0; fi
    fence writer_authority_undetermined ;;
  unfence)
    [ "${LEMTEL_BF_UNFENCE_ACK:-}" = 'I_CONFIRM_DO_IS_THE_ONLY_WRITER' ] || { say 'boot_fence_status=failed'; say 'reason=unfence_acknowledgement_required'; exit 1; }
    hostinger_promoted && { say 'boot_fence_status=failed'; say 'reason=hostinger_still_serving_as_writer'; exit 1; }
    rm -f -- "$FENCED"; confirm operator_unfence ;;
  status)
    [ -e "$FENCED" ] && { say 'boot_fence=fenced'; sed 's/^/fence_/' "$FENCED"; } || say 'boot_fence=not_fenced'
    [ -e "$CONFIRMED" ] && say 'writer_authority_this_boot=confirmed' || say 'writer_authority_this_boot=not_confirmed' ;;
  *) say 'boot_fence_status=failed'; say 'reason=invalid_mode'; exit 1 ;;
esac
