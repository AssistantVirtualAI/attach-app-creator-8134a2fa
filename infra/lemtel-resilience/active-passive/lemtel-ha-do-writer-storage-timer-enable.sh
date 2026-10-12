#!/usr/bin/env bash
# Root-only installation of the DigitalOcean-owned timer for one-way private
# Storage replication to the Hostinger standby.
set -euo pipefail

fail() {
  printf 'do_writer_storage_timer_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_do_writer_private_storage_sync_timer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

source_script='/home/lemtelops/lemtel-ha-do-writer-storage-sync.sh'
installed_script='/usr/local/sbin/lemtel-ha-do-writer-storage-sync'
service_file='/etc/systemd/system/lemtel-ha-do-writer-storage-sync.service'
timer_file='/etc/systemd/system/lemtel-ha-do-writer-storage-sync.timer'

command -v systemctl >/dev/null 2>&1 || fail systemd_missing
command -v systemd-analyze >/dev/null 2>&1 || fail systemd_analyze_missing
[ -x "$source_script" ] || fail storage_sync_script_missing
[ ! -e "$service_file" ] || fail service_already_exists
[ ! -e "$timer_file" ] || fail timer_already_exists
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive

install -o root -g root -m 0700 "$source_script" "$installed_script"
cat > "$service_file" <<'UNIT'
[Unit]
Description=Lemtel one-way private Storage replication to Hostinger standby
Wants=network-online.target
After=network-online.target wg-quick@lemtel-ha0.service
ConditionPathExists=/etc/lemtel-ha/storage-sync/id_ed25519

[Service]
Type=oneshot
User=root
Group=root
Environment=LEMTEL_HA_EXECUTE=sync_do_writer_private_storage_once
Environment=LEMTEL_HA_ROLE=digitalocean_writer
Environment=LEMTEL_HA_STORAGE_BACKEND=local_filesystem
ExecStart=/usr/local/sbin/lemtel-ha-do-writer-storage-sync
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
TimeoutStartSec=15min
UNIT

cat > "$timer_file" <<'UNIT'
[Unit]
Description=Schedule Lemtel private Storage replication from DO

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
AccuracySec=30s
Persistent=true
Unit=lemtel-ha-do-writer-storage-sync.service

[Install]
WantedBy=timers.target
UNIT

systemd-analyze verify "$service_file" "$timer_file" || fail systemd_unit_invalid
systemctl daemon-reload
systemctl enable --now lemtel-ha-do-writer-storage-sync.timer
systemctl is-enabled --quiet lemtel-ha-do-writer-storage-sync.timer || fail timer_not_enabled
systemctl is-active --quiet lemtel-ha-do-writer-storage-sync.timer || fail timer_not_active
systemctl start lemtel-ha-do-writer-storage-sync.service
systemctl is-active --quiet lemtel-ha-do-writer-storage-sync.service || fail initial_sync_not_complete

printf 'do_writer_storage_timer_format=lemtel_do_writer_storage_timer_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'sync_interval=5_minutes_with_jitter\n'
printf 'sync_direction=digitalocean_to_hostinger_only\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'timer_enabled=true\n'
printf 'timer_active=true\n'
printf 'initial_sync_complete=true\n'
printf 'standby_storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_storage_timer_status=complete\n'
