#!/usr/bin/env bash
# Root-only installation of primary health monitoring. It records status locally; notification delivery is separate.
set -euo pipefail

fail() {
  printf 'primary_health_timer_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_private_active_passive_health_timer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

source_script='/home/lemtelops/lemtel-ha-primary-health-check.sh'
installed_script='/usr/local/sbin/lemtel-ha-primary-health-check'
service_file='/etc/systemd/system/lemtel-ha-primary-health.service'
timer_file='/etc/systemd/system/lemtel-ha-primary-health.timer'

command -v systemctl >/dev/null 2>&1 || fail systemd_missing
command -v systemd-analyze >/dev/null 2>&1 || fail systemd_analyze_missing
[ -x "$source_script" ] || fail health_script_missing
[ ! -e "$service_file" ] || fail service_already_exists
[ ! -e "$timer_file" ] || fail timer_already_exists
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive

install -o root -g root -m 0700 "$source_script" "$installed_script"
cat > "$service_file" <<'UNIT'
[Unit]
Description=Lemtel primary active-passive health monitor
Wants=network-online.target
After=network-online.target wg-quick@lemtel-ha0.service lemtel-ha-storage-sync.timer

[Service]
Type=oneshot
User=root
Group=root
Environment=LEMTEL_HA_EXECUTE=check_private_active_passive_health
Environment=LEMTEL_HA_ROLE=hostinger_primary
ExecStart=/usr/local/sbin/lemtel-ha-primary-health-check
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
TimeoutStartSec=45s
UNIT

cat > "$timer_file" <<'UNIT'
[Unit]
Description=Schedule Lemtel primary active-passive health monitoring

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
RandomizedDelaySec=15s
AccuracySec=15s
Persistent=true
Unit=lemtel-ha-primary-health.service

[Install]
WantedBy=timers.target
UNIT

systemd-analyze verify "$service_file" "$timer_file" || fail systemd_unit_invalid
systemctl daemon-reload
systemctl enable --now lemtel-ha-primary-health.timer
systemctl is-enabled --quiet lemtel-ha-primary-health.timer || fail timer_not_enabled
systemctl is-active --quiet lemtel-ha-primary-health.timer || fail timer_not_active

printf 'primary_health_timer_format=lemtel_primary_health_timer_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'health_check_interval=2_minutes_with_jitter\n'
printf 'notification_delivery_configured=false\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'primary_health_timer_status=complete\n'
