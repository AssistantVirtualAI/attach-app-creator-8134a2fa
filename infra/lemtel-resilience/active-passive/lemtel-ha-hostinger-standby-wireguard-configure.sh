#!/usr/bin/env bash
# Starts only the private WireGuard initiator on a clean Hostinger standby.
# It never starts PostgreSQL, Storage, Caddy, DNS, public listeners, promotion or telephony.
set -euo pipefail

fail() {
  printf 'hostinger_standby_wireguard_status=%s\n' "$1" >&2
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
[ "${LEMTEL_HA_EXECUTE:-}" = 'configure_hostinger_standby_wireguard_from_do_writer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

peer_key="${LEMTEL_DO_WRITER_WIREGUARD_PUBLIC_KEY:-}"
peer_endpoint="${LEMTEL_DO_WRITER_WIREGUARD_ENDPOINT:-}"
interface='lemtel-ha0'
config_path="/etc/wireguard/${interface}.conf"
service="wg-quick@${interface}"
private_key_path='/etc/lemtel-ha/wireguard/private.key'
local_address='10.253.47.2/30'
peer_address='10.253.47.1/32'

require_key "$peer_key" || fail invalid_do_writer_public_key
endpoint_ip="${peer_endpoint%:*}"
endpoint_port="${peer_endpoint##*:}"
require_ipv4 "$endpoint_ip" || fail invalid_do_writer_endpoint
[[ "$endpoint_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$endpoint_port" -le 65535 ] || fail invalid_do_writer_endpoint
command -v wg >/dev/null 2>&1 && command -v wg-quick >/dev/null 2>&1 || fail wireguard_tools_missing
[ -s "$private_key_path" ] || fail hostinger_private_key_missing
[ ! -e "$config_path" ] || fail existing_configuration_requires_separate_change
! systemctl is-active --quiet "$service" || fail existing_active_interface_requires_separate_change
! ip link show "$interface" >/dev/null 2>&1 || fail existing_interface_requires_separate_change

install -d -m 0700 /etc/wireguard
umask 077
tmp_config="$(mktemp /etc/wireguard/.${interface}.conf.XXXXXX)"
cleanup() { rm -f "$tmp_config"; }
trap cleanup EXIT
cat > "$tmp_config" <<EOF
[Interface]
Address = ${local_address}
PrivateKey = $(< "$private_key_path")

[Peer]
PublicKey = ${peer_key}
AllowedIPs = ${peer_address}
Endpoint = ${peer_endpoint}
PersistentKeepalive = 25
EOF
chmod 0600 "$tmp_config"
mv "$tmp_config" "$config_path"
trap - EXIT

if ! systemctl enable --now "$service"; then
  rm -f "$config_path"
  systemctl disable "$service" >/dev/null 2>&1 || true
  fail service_start_failed_configuration_removed
fi

ip -4 addr show dev "$interface" | grep -Fq '10.253.47.2/30' || fail local_address_not_applied
wg show "$interface" peers | grep -qx "$peer_key" || fail peer_not_applied

printf 'hostinger_standby_wireguard_format=lemtel_inverse_wireguard_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'private_tunnel_interface=started\n'
printf 'private_database_listener_enabled=false\n'
printf 'postgres_started=false\n'
printf 'storage_started=false\n'
printf 'runtime_started=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_standby_wireguard_status=complete\n'
