#!/usr/bin/env bash
# Root-only activation of Lemtel active-passive state-transition email alerts.
set -euo pipefail

fail() {
  printf 'primary_health_alerts_enable_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_private_active_passive_email_alerts' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

source_script='/home/lemtelops/lemtel-ha-primary-alert-dispatch.sh'
installed_script='/usr/local/sbin/lemtel-ha-primary-alert-dispatch'
recipients_file='/etc/lemtel-ha/primary-health-alert-recipients'
service_file='/etc/systemd/system/lemtel-ha-primary-alert-dispatch.service'
timer_file='/etc/systemd/system/lemtel-ha-primary-alert-dispatch.timer'
recipients_csv="${LEMTEL_HA_ALERT_RECIPIENTS:-}"

command -v systemctl >/dev/null 2>&1 || fail systemd_missing
command -v systemd-analyze >/dev/null 2>&1 || fail systemd_analyze_missing
[ -x "$source_script" ] || fail alert_dispatch_script_missing
[ -n "$recipients_csv" ] || fail recipients_required
[ ! -e "$service_file" ] || fail service_already_exists
[ ! -e "$timer_file" ] || fail timer_already_exists
systemctl is-active --quiet lemtel-ha-primary-health.timer || fail health_timer_inactive
systemctl is-enabled --quiet lemtel-ha-primary-health.timer || fail health_timer_disabled

umask 077
recipients_tmp="$(mktemp)"
trap 'rm -f "$recipients_tmp"' EXIT
printf '%s' "$recipients_csv" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d' > "$recipients_tmp"
recipient_count="$(wc -l < "$recipients_tmp" | tr -d ' ')"
[ "$recipient_count" -ge 1 ] && [ "$recipient_count" -le 50 ] || fail recipient_count_invalid
while IFS= read -r recipient; do
  [[ "$recipient" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail recipient_invalid
done < "$recipients_tmp"

install -d -o root -g root -m 0700 /etc/lemtel-ha
install -o root -g root -m 0600 "$recipients_tmp" "$recipients_file"
install -o root -g root -m 0700 "$source_script" "$installed_script"

cat > "$service_file" <<'UNIT'
[Unit]
Description=Lemtel primary active-passive email alert dispatch
Wants=network-online.target
After=network-online.target docker.service lemtel-ha-primary-health.service

[Service]
Type=oneshot
User=root
Group=root
Environment=LEMTEL_HA_EXECUTE=dispatch_private_active_passive_health_alert
Environment=LEMTEL_HA_ROLE=hostinger_primary
ExecStart=/usr/local/sbin/lemtel-ha-primary-alert-dispatch
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
TimeoutStartSec=45s
UNIT

cat > "$timer_file" <<'UNIT'
[Unit]
Description=Schedule Lemtel primary active-passive email alert dispatch

[Timer]
OnBootSec=90s
OnUnitActiveSec=2min
RandomizedDelaySec=20s
AccuracySec=20s
Persistent=true
Unit=lemtel-ha-primary-alert-dispatch.service

[Install]
WantedBy=timers.target
UNIT

systemd-analyze verify "$service_file" "$timer_file" || fail systemd_unit_invalid
systemctl daemon-reload
systemctl enable --now lemtel-ha-primary-alert-dispatch.timer
systemctl is-enabled --quiet lemtel-ha-primary-alert-dispatch.timer || fail timer_not_enabled
systemctl is-active --quiet lemtel-ha-primary-alert-dispatch.timer || fail timer_not_active
systemctl start lemtel-ha-primary-alert-dispatch.service

printf 'primary_health_alerts_enable_format=lemtel_primary_health_alerts_enable_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'email_alerts_enabled=true\n'
printf 'alert_recipient_count=%s\n' "$recipient_count"
printf 'resend_existing_runtime_secret_reused=true\n'
printf 'alert_dispatch_interval=2_minutes_with_jitter\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_health_alerts_enable_status=complete\n'
