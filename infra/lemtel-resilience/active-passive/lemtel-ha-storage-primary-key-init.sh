#!/usr/bin/env bash
# Root-only setup of the Hostinger key used only to push filesystem Storage to the private standby receiver.
set -euo pipefail

fail() {
  printf 'storage_primary_key_init_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'initialize_private_storage_sync_key' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role
[ "${LEMTEL_HA_STORAGE_BACKEND:-}" = filesystem ] || fail unexpected_storage_backend

standby_host='10.253.47.2'
primary_tunnel_address='10.253.47.1'
key_dir='/etc/lemtel-ha/storage-sync'
key_file="$key_dir/id_ed25519"
known_hosts="$key_dir/known_hosts"
standby_host_key="${LEMTEL_HA_STANDBY_HOST_KEY:-}"

case "$standby_host_key" in
  "$standby_host"\ ssh-ed25519\ *) ;;
  *) fail invalid_standby_host_key ;;
esac
[[ "$standby_host_key" != *$'\n'* && "$standby_host_key" != *$'\r'* ]] || fail invalid_standby_host_key

command -v ssh-keygen >/dev/null 2>&1 || fail ssh_keygen_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -q "$primary_tunnel_address" || fail primary_tunnel_address_missing

install -d -m 0700 "$key_dir"
if [ ! -f "$key_file" ]; then
  umask 077
  ssh-keygen -q -t ed25519 -N '' -C 'lemtel-ha-storage-sync-primary' -f "$key_file"
fi
if [ ! -f "$key_file.pub" ]; then
  ssh-keygen -y -f "$key_file" > "$key_file.pub"
fi
chmod 0600 "$key_file"
chmod 0644 "$key_file.pub"
ssh-keygen -lf "$key_file.pub" >/dev/null || fail invalid_storage_sync_public_key

if [ -e "$known_hosts" ] && ! grep -Fxq "$standby_host_key" "$known_hosts"; then
  fail standby_host_key_mismatch
fi
printf '%s\n' "$standby_host_key" > "$known_hosts"
chmod 0600 "$known_hosts"

printf 'storage_primary_key_init_format=lemtel_storage_primary_key_init_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'storage_backend=filesystem\n'
printf 'wireguard_handshake_verified=true\n'
printf 'standby_host_key_pinned=true\n'
printf 'storage_sync_public_key='
cat "$key_file.pub"
printf 'storage_replication_started=false\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'storage_primary_key_init_status=complete\n'
