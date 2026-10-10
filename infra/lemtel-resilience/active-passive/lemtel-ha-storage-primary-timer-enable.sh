#!/usr/bin/env bash
# Root-only installation of a Hostinger-owned timer for one-way, private Storage replication.
set -euo pipefail

fail() {
  printf 'storage_primary_timer_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_private_storage_sync_timer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

source_script='/home/lemtelops/lemtel-ha-storage-primary-sync.sh'
installed_script='/usr/local/sbin/lemtel-ha-storage-primary-sync'
service_file='/etc/systemd/system/lemtel-ha-storage-sync.service'
timer_file='/etc/systemd/system/lemtel-ha-storage-sync.timer'

command -v systemctl >/dev/null 2>&1 || fail systemd_missing
command -v systemd-analyze >/dev/null 2>&1 || fail systemd_analyze_missing
[ -x "$source_script" ] || fail storage_sync_script_missing
[ ! -e "$service_file" ] || fail service_already_exists
[ ! -e "$timer_file" ] || fail timer_already_exists
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive

install -o root -g root -m 0700 "$source_script" "$installed_script"
cat > "$service_file" <<'UNIT'
[Unit]
Description=Lemtel one-way private Storage replication to DigitalOcean standby
Wants=network-online.target
After=network-online.target wg-quick@lemtel-ha0.service
ConditionPathExists=/etc/lemtel-ha/storage-sync/id_ed25519

[Service]
Type=oneshot
User=root
Group=root
Environment=LEMTEL_HA_EXECUTE=sync_private_storage_once
Environment=LEMTEL_HA_ROLE=hostinger_primary
Environment=LEMTEL_HA_STORAGE_BACKEND=local_filesystem
ExecStart=/usr/local/sbin/lemtel-ha-storage-primary-sync
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
TimeoutStartSec=15min
UNIT

cat > "$timer_file" <<'UNIT'
[Unit]
Description=Schedule Lemtel private Storage replication

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
AccuracySec=30s
Persistent=true
Unit=lemtel-ha-storage-sync.service

[Install]
WantedBy=timers.target
UNIT

systemd-analyze verify "$service_file" "$timer_file" || fail systemd_unit_invalid
systemctl daemon-reload
systemctl enable --now lemtel-ha-storage-sync.timer
systemctl is-enabled --quiet lemtel-ha-storage-sync.timer || fail timer_not_enabled
systemctl is-active --quiet lemtel-ha-storage-sync.timer || fail timer_not_active

printf 'storage_primary_timer_format=lemtel_storage_primary_timer_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'sync_interval=5_minutes_with_jitter\n'
printf 'sync_direction=hostinger_to_digitalocean_only\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'timer_enabled=true\n'
printf 'timer_active=true\n'
printf 'standby_storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'storage_primary_timer_status=complete\n'
