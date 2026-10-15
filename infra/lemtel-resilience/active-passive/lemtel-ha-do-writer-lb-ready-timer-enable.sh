#!/usr/bin/env bash
# Installs the local, fail-closed freshness timer for the public L7 readiness marker.
set -euo pipefail
fail() { printf 'do_writer_l7_ready_timer_status=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_digitalocean_writer_l7_ready_timer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role
source_script="${LEMTEL_L7_READY_SOURCE:-/home/lemtelops/lemtel-ha-do-writer-lb-ready-refresh.sh}"
installed_script='/usr/local/sbin/lemtel-ha-do-writer-lb-ready-refresh'
service_file='/etc/systemd/system/lemtel-ha-do-writer-lb-ready.service'
timer_file='/etc/systemd/system/lemtel-ha-do-writer-lb-ready.timer'
[ -f "$source_script" ] || fail readiness_source_missing
install -o root -g root -m 0750 "$source_script" "$installed_script"
cat > "$service_file" <<'UNIT'
[Unit]
Description=Lemtel DO writer L7 readiness marker
After=network-online.target docker.service wg-quick@lemtel-ha0.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=LEMTEL_HA_EXECUTE=refresh_digitalocean_writer_l7_ready
Environment=LEMTEL_HA_ROLE=digitalocean_promoted_writer
ExecStart=/usr/local/sbin/lemtel-ha-do-writer-lb-ready-refresh
UNIT
cat > "$timer_file" <<'UNIT'
[Unit]
Description=Refresh Lemtel DO writer L7 readiness marker

[Timer]
OnBootSec=45
OnUnitActiveSec=60
RandomizedDelaySec=20
Persistent=true
Unit=lemtel-ha-do-writer-lb-ready.service

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now lemtel-ha-do-writer-lb-ready.timer
systemctl start lemtel-ha-do-writer-lb-ready.service
systemctl is-active --quiet lemtel-ha-do-writer-lb-ready.timer || fail timer_not_active
[ -f /var/lib/lemtel-ha/health/nonexistent ] || true
printf 'do_writer_l7_ready_timer_format=lemtel_do_writer_l7_ready_timer_v1\n'
printf 'timer_active=true\n'
printf 'cadence=60_seconds_bounded_jitter\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'do_writer_l7_ready_timer_status=complete\n'
