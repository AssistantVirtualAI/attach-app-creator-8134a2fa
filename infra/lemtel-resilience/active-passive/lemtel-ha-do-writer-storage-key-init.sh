#!/usr/bin/env bash
# Root-only installation of a pre-generated dedicated SSH key for the
# DigitalOcean writer to push Storage only to the restricted Hostinger receiver.
set -euo pipefail

fail() {
  printf 'do_writer_storage_key_init_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'initialize_do_writer_private_storage_sync_key' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role
[ "${LEMTEL_HA_STORAGE_BACKEND:-}" = local_filesystem ] || fail unexpected_storage_backend

standby_tunnel_address='10.253.47.1'
writer_tunnel_address='10.253.47.2'
key_dir='/etc/lemtel-ha/storage-sync'
key_file="$key_dir/id_ed25519"
known_hosts="$key_dir/known_hosts"
staged_key='/home/lemtelops/.lemtel-ha/storage-sync-id_ed25519'
staged_public_key="${staged_key}.pub"

command -v ssh-keygen >/dev/null 2>&1 || fail ssh_keygen_missing
command -v ssh-keyscan >/dev/null 2>&1 || fail ssh_keyscan_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq "$writer_tunnel_address" || fail writer_tunnel_address_missing
[ -f "$staged_key" ] && [ -f "$staged_public_key" ] || fail staged_storage_key_missing
[ "$(stat -c '%a' "$staged_key")" = 600 ] || fail staged_storage_key_permissions_invalid
ssh-keygen -lf "$staged_public_key" >/dev/null || fail invalid_staged_storage_public_key

install -d -m 0700 "$key_dir"
if [ -e "$key_file" ]; then
  cmp -s "$key_file" "$staged_key" || fail existing_storage_key_mismatch
else
  install -m 0600 "$staged_key" "$key_file"
  install -m 0644 "$staged_public_key" "${key_file}.pub"
fi
ssh-keygen -y -f "$key_file" | cmp -s - "${key_file}.pub" || fail installed_storage_key_mismatch

keyscan_tmp="$(mktemp "${key_dir}/.known-hosts.XXXXXX")"
trap 'rm -f "$keyscan_tmp"' EXIT
ssh-keyscan -T 10 -t ed25519 "$standby_tunnel_address" 2>/dev/null | grep -F "$standby_tunnel_address ssh-ed25519 " > "$keyscan_tmp" || fail standby_host_key_scan_failed
[ "$(wc -l < "$keyscan_tmp")" -eq 1 ] || fail standby_host_key_ambiguous
if [ -e "$known_hosts" ] && ! cmp -s "$keyscan_tmp" "$known_hosts"; then
  fail standby_host_key_mismatch
fi
install -m 0600 "$keyscan_tmp" "$known_hosts"
rm -f "$staged_key" "$staged_public_key"

printf 'do_writer_storage_key_init_format=lemtel_do_writer_storage_key_init_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'wireguard_handshake_verified=true\n'
printf 'standby_host_key_pinned=true\n'
printf 'storage_sync_key_installed=true\n'
printf 'storage_sync_public_key_emitted=false\n'
printf 'storage_replication_started=false\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_storage_key_init_status=complete\n'
