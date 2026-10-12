#!/usr/bin/env bash
# Root-only installation of the promoted-writer redacted status timer.
set -euo pipefail

fail() {
  printf 'promoted_writer_status_timer_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_redacted_promoted_writer_status_timer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role

source_script="${LEMTEL_HA_STATUS_PUBLISHER_PATH:-}"
[ -n "$source_script" ] && [ -f "$source_script" ] || fail publisher_source_missing

install -o root -g root -m 0700 "$source_script" /usr/local/sbin/lemtel-ha-promoted-writer-status-publish

cat > /etc/systemd/system/lemtel-ha-promoted-writer-status.service <<'UNIT'
[Unit]
Description=Lemtel promoted writer redacted operational status publisher
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=LEMTEL_HA_EXECUTE=publish_redacted_promoted_writer_status
Environment=LEMTEL_HA_ROLE=digitalocean_promoted_writer
ExecStart=/usr/local/sbin/lemtel-ha-promoted-writer-status-publish
UNIT

cat > /etc/systemd/system/lemtel-ha-promoted-writer-status.timer <<'UNIT'
[Unit]
Description=Schedule Lemtel promoted writer redacted operational status publisher

[Timer]
OnBootSec=90s
OnUnitActiveSec=2min
RandomizedDelaySec=20s
Persistent=true
Unit=lemtel-ha-promoted-writer-status.service

[Install]
WantedBy=timers.target
UNIT

systemd-analyze verify /etc/systemd/system/lemtel-ha-promoted-writer-status.service /etc/systemd/system/lemtel-ha-promoted-writer-status.timer
systemctl daemon-reload
systemctl enable --now lemtel-ha-promoted-writer-status.timer
systemctl start lemtel-ha-promoted-writer-status.service

printf 'promoted_writer_status_timer_status=complete\n'
printf 'publisher_cadence=2min_bounded_jitter\n'
printf 'redacted_status_only=true\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_failover_enabled=false\n'
printf 'hostinger_rebuild_or_start=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
