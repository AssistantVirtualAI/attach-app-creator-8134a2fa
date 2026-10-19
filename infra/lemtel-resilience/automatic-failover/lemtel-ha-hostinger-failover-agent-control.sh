# Lemtel — streamed to `bash -s` on the Hostinger standby (root). Operator control of the failover agent:
#   start   : prepares the evidence directory, installs the reviewed unit files and starts the poll timer
#             (the configured mode is reported; nothing else changes)
#   start_permanent : same as start, and the timer is also started at every boot of the standby (permanent
#             automatic failover). Uses a timers.target.wants link: the reviewed unit files stay unchanged.
#   stop    : stops the timer and any running poll, removes the boot link, reports the incident ledger
#   archive : after a drill, moves the per-incident evidence (fence receipt, stage attestation) to an archive
#             so the next real incident is not blocked by a drill's one-time files
#   status  : read-only
# Never promotes, never starts the runtime, never changes the agent configuration.
set -euo pipefail
umask 077
MODE="${LEMTEL_AGENT_CONTROL_MODE:-status}"
D=/opt/lemtel-ha/automatic-failover
EVIDENCE=/var/lib/lemtel-ha/current-topology-evidence
STATE=/var/lib/lemtel-ha/failover-agent
BOOT_LINK=/etc/systemd/system/timers.target.wants/lemtel-ha-hostinger-failover-agent.timer
fail() { printf 'agent_control_status=failed\nreason=%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail root_required
report() {
  echo "agent_timer=$(systemctl is-active lemtel-ha-hostinger-failover-agent.timer 2>/dev/null || true)"
  echo "agent_starts_at_boot=$([ -L "$BOOT_LINK" ] && echo true || echo false)"
  echo "agent_promotion_mode=$(sed -n 's/^PROMOTION_EXECUTION_MODE=//p' /etc/lemtel-ha/failover-agent.env 2>/dev/null || echo none)"
  echo "agent_last_result=$(journalctl -u lemtel-ha-hostinger-failover-agent.service -n 30 --no-pager -o cat 2>/dev/null | grep -E 'hostinger_failover_agent_status=|reason=|error_class=' | tail -3 | tr '\n' ' ')"
  for f in "$STATE"/*.consumed; do [ -e "$f" ] && echo "incident_ledger $(basename "$f" .consumed | cut -c1-8)…: $(tr '\n' ' ' < "$f")"; done
  ls "$EVIDENCE" 2>/dev/null | sed 's/^/evidence_file=/'
  echo "standby_in_recovery=$(docker exec -u postgres lemtel-postgres-hostinger-standby psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null)"
}
case "$MODE" in
  start|start_permanent)
    [ -s /etc/lemtel-ha/failover-agent.env ] || fail agent_not_configured
    install -d -o root -g root -m 0700 "$EVIDENCE"
    for unit in lemtel-ha-hostinger-failover-agent.service lemtel-ha-hostinger-failover-agent.timer; do
      [ -f "$D/$unit" ] || fail "missing_$unit"; install -o root -g root -m 0644 "$D/$unit" "/etc/systemd/system/$unit"
    done
    if [ "$MODE" = start_permanent ]; then
      grep -qx 'PROMOTION_EXECUTION_MODE=execute' /etc/lemtel-ha/failover-agent.env || fail permanent_requires_execute_configuration
      install -d -o root -g root -m 0755 "$(dirname "$BOOT_LINK")"
      ln -sfn /etc/systemd/system/lemtel-ha-hostinger-failover-agent.timer "$BOOT_LINK"
    else
      rm -f -- "$BOOT_LINK"
    fi
    systemctl daemon-reload
    systemctl start lemtel-ha-hostinger-failover-agent.timer
    echo 'agent_timer_started=true'; report; echo 'agent_control_status=complete' ;;
  stop)
    rm -f -- "$BOOT_LINK"; systemctl daemon-reload
    systemctl stop lemtel-ha-hostinger-failover-agent.timer lemtel-ha-hostinger-failover-agent.service 2>/dev/null || true
    echo 'agent_timer_stopped=true'; report; echo 'agent_control_status=complete' ;;
  archive)
    [ "$(systemctl is-active lemtel-ha-hostinger-failover-agent.timer 2>/dev/null || true)" != active ] || fail stop_the_agent_first
    archive="/var/lib/lemtel-ha/drill-archive/$(date -u +%Y%m%dT%H%M%SZ)"; install -d -m 0700 "$archive"
    for f in "$EVIDENCE"/do-writer-fence-receipt.state "$EVIDENCE"/hostinger-runtime-stage.state; do [ -e "$f" ] && mv -- "$f" "$archive/"; done
    for f in "$STATE"/*.consumed; do [ -e "$f" ] && cp -p -- "$f" "$archive/"; done
    echo "drill_evidence_archived=$archive"; report; echo 'agent_control_status=complete' ;;
  status) report; echo 'agent_control_status=complete' ;;
  *) fail invalid_mode ;;
esac
