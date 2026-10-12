#!/usr/bin/env bash
# Replaces the former fenced peer with the clean Hostinger standby on DO's private tunnel.
# This script never starts a database standby, runtime, Storage, DNS failover, promotion or telephony.
set -euo pipefail

fail() {
  printf 'do_writer_wireguard_peer_status=%s\n' "$1" >&2
  exit 1
}

require_key() {
  [[ "$1" =~ ^[A-Za-z0-9+/]{43}=$ ]]
}

require_ipv4() {
  local value="$1" octet
  IFS='.' read -r -a octets <<< "$value"
  [ "${#octets[@]}" -eq 4 ] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]+$ ]] || return 1
    [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
  done
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'apply_hostinger_standby_wireguard_peer_on_do_writer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

new_peer_key="${LEMTEL_HOSTINGER_STANDBY_WIREGUARD_PUBLIC_KEY:-}"
new_peer_endpoint="${LEMTEL_HOSTINGER_STANDBY_WIREGUARD_ENDPOINT:-}"
interface='lemtel-ha0'
config_path="/etc/wireguard/${interface}.conf"
service="wg-quick@${interface}"
# DigitalOcean was promoted from the former standby. Its tunnel address remains
# .2. The reconstructed Hostinger node is the new passive peer at .1.
expected_address='10.253.47.2/30'
expected_allowed_ip='10.253.47.1/32'

require_key "$new_peer_key" || fail invalid_hostinger_standby_public_key
endpoint_ip="${new_peer_endpoint%:*}"
endpoint_port="${new_peer_endpoint##*:}"
require_ipv4 "$endpoint_ip" || fail invalid_hostinger_standby_endpoint
[[ "$endpoint_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$endpoint_port" -le 65535 ] || fail invalid_hostinger_standby_endpoint
command -v wg >/dev/null 2>&1 || fail wireguard_tools_missing
systemctl is-active --quiet "$service" || fail writer_tunnel_inactive
[ -s "$config_path" ] || fail writer_tunnel_configuration_missing
ip -4 addr show dev "$interface" | grep -Fq "$expected_address" || fail unexpected_writer_tunnel_address

mapfile -t old_peers < <(wg show "$interface" peers)
[ "${#old_peers[@]}" -le 1 ] || fail unexpected_writer_peer_count
old_peer="${old_peers[0]:-}"
[ "$old_peer" != "$new_peer_key" ] || fail hostinger_peer_already_active

rollback_dir='/etc/lemtel-ha/rollback'
install -d -m 0700 "$rollback_dir"
backup_conf="$rollback_dir/${interface}.conf.before-hostinger-standby"
backup_runtime="$(mktemp "$rollback_dir/.${interface}.showconf.XXXXXX")"
cp -a "$config_path" "$backup_conf"
wg showconf "$interface" > "$backup_runtime"
chmod 0600 "$backup_runtime"
rollback() {
  cp -a "$backup_conf" "$config_path"
  wg setconf "$interface" "$backup_runtime" || true
}
trap rollback ERR

private_key="$(wg show "$interface" private-key)"
listen_port="$(wg show "$interface" listen-port)"
require_key "$private_key" || fail writer_private_key_unavailable
[[ "$listen_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$listen_port" -le 65535 ] || fail writer_listen_port_unavailable

if [ -n "$old_peer" ]; then
  wg set "$interface" peer "$old_peer" remove
  former_peer_replaced=true
else
  # A promoted writer can already have no peer after fencing. Adding the clean
  # standby is then safe and does not imply an automatic promotion path.
  former_peer_replaced=false
fi
wg set "$interface" peer "$new_peer_key" allowed-ips "$expected_allowed_ip" endpoint "$new_peer_endpoint" persistent-keepalive 25

umask 077
tmp_conf="$(mktemp /etc/wireguard/.${interface}.conf.XXXXXX)"
cat > "$tmp_conf" <<EOF
[Interface]
Address = ${expected_address}
ListenPort = ${listen_port}
PrivateKey = ${private_key}

[Peer]
PublicKey = ${new_peer_key}
AllowedIPs = ${expected_allowed_ip}
Endpoint = ${new_peer_endpoint}
PersistentKeepalive = 25
EOF
chmod 0600 "$tmp_conf"
mv "$tmp_conf" "$config_path"

wg show "$interface" peers | grep -qx "$new_peer_key" || fail new_peer_not_active
wg show "$interface" allowed-ips | grep -Fq "$expected_allowed_ip" || fail expected_allowed_ip_not_active
trap - ERR
rm -f "$backup_runtime"

printf 'do_writer_wireguard_peer_format=lemtel_inverse_wireguard_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'former_peer_replaced=%s\n' "$former_peer_replaced"
printf 'private_tunnel_interface=healthy\n'
printf 'private_database_listener_enabled=false\n'
printf 'postgres_changed=false\n'
printf 'storage_changed=false\n'
printf 'runtime_changed=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_wireguard_peer_status=complete\n'
