#!/usr/bin/env bash
# Installs the DO writer boot fence (root, DO writer only). Confirms writer authority for the current boot
# first (the Hostinger standby must be streaming from DO), then adds systemd conditions so the readiness
# marker and the Storage copy only run once authority is confirmed on each boot. Any failure removes what
# this run added. Never stops a container, never contacts Cloudflare or Hostinger beyond read-only checks.
set -euo pipefail
umask 022
fail() { printf 'boot_fence_apply_status=failed\nreason=%s\n' "$1"; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail invalid_role
[ "${LEMTEL_HA_EXECUTE:-}" = install_do_writer_boot_fence ] || fail execution_token_required
src="${LEMTEL_BOOT_FENCE_SOURCE:?}"
target=/usr/local/sbin/lemtel-ha-do-writer-boot-fence
units=/etc/systemd/system
[ "$(docker exec lemtel-postgres-standby sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_is_in_recovery()"')" = f ] || fail not_the_writer
for unit in lemtel-ha-do-writer-lb-ready.service lemtel-ha-do-writer-storage-sync.service; do [ -f "$units/$unit" ] || fail "missing_$unit"; done
[ ! -e "$units/lemtel-ha-do-writer-boot-fence-clear.service" ] || fail already_installed
created=()
rollback() {
  for path in "${created[@]}"; do rm -rf -- "$path"; done
  systemctl daemon-reload || true
  fail "$1"
}
install -o root -g root -m 0750 "$src" "$target"; created+=("$target")
# Authority for this boot BEFORE any condition exists, so the marker and Storage copy never pause.
out="$(LEMTEL_BF_WAIT_SECONDS=60 "$target" decide)" || rollback decide_failed
printf '%s\n' "$out"
printf '%s\n' "$out" | grep -q '^boot_fence=writer_authority_confirmed$' || rollback writer_authority_not_confirmed_now
cat > "$units/lemtel-ha-do-writer-boot-fence-clear.service" <<'UNIT'
[Unit]
Description=Lemtel DO boot fence: remove the readiness marker before Docker starts
Before=docker.service
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lemtel-ha-do-writer-boot-fence boot-clear

[Install]
WantedBy=multi-user.target
UNIT
created+=("$units/lemtel-ha-do-writer-boot-fence-clear.service")
cat > "$units/lemtel-ha-do-writer-boot-fence.service" <<'UNIT'
[Unit]
Description=Lemtel DO boot fence: confirm writer authority or stay fenced
Wants=network-online.target
After=network-online.target docker.service wg-quick@lemtel-ha0.service lemtel-ha-do-postgres-wireguard-relay.service

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=15min
ExecStart=/usr/local/sbin/lemtel-ha-do-writer-boot-fence decide

[Install]
WantedBy=multi-user.target
UNIT
created+=("$units/lemtel-ha-do-writer-boot-fence.service")
for unit in lemtel-ha-do-writer-lb-ready.service lemtel-ha-do-writer-storage-sync.service; do
  install -d -m 0755 "$units/$unit.d"
  printf '[Unit]\n# Lemtel DO boot fence: only while writer authority is confirmed for this boot.\nConditionPathExists=/run/lemtel-ha/writer-authority-confirmed\n' > "$units/$unit.d/50-lemtel-boot-fence.conf"
  created+=("$units/$unit.d/50-lemtel-boot-fence.conf")
done
systemctl daemon-reload || rollback daemon_reload_failed
systemctl --quiet enable lemtel-ha-do-writer-boot-fence-clear.service lemtel-ha-do-writer-boot-fence.service || rollback enable_failed
# The decide unit is marked active for this boot without re-running (authority already confirmed above).
systemctl start lemtel-ha-do-writer-lb-ready.service || rollback marker_refresh_failed_after_install
[ -s /opt/lemtel-ha/runtime-stage/volumes/proxy/caddy/lemtel-lb-ready.json ] || rollback marker_missing_after_install
printf 'boot_fence_installed=true\nmarker_and_storage_copy_gated_on_authority=true\ncontainers_stopped=false\nboot_fence_apply_status=complete\n'
