#!/usr/bin/env bash
# Configures the Lemtel HA WireGuard interface after both host public keys are verified.
# PostgreSQL remains unbound to public interfaces; this script does not configure PostgreSQL, Storage, DNS, or telephony.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'wireguard_tunnel_status=root_required\n' >&2
    exit 1
  fi
}

require_value() {
  local label="$1" value="$2"
  if [ -z "$value" ] || [[ "$value" == *$'\n'* ]] || [[ "$value" == *$'\r'* ]]; then
    printf 'wireguard_tunnel_status=invalid_%s\n' "$label" >&2
    exit 1
  fi
}

require_port() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) [ "$1" -le 65535 ] ;;
  esac
}

require_wireguard_key() {
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

require_root
role="${LEMTEL_HA_ROLE:-}"
peer_public_key="${LEMTEL_PEER_PUBLIC_KEY:-}"
local_address="${LEMTEL_LOCAL_TUNNEL_ADDRESS:-}"
peer_address="${LEMTEL_PEER_TUNNEL_ADDRESS:-}"
peer_endpoint="${LEMTEL_PEER_ENDPOINT:-}"
firewall_peer_public_ip="${LEMTEL_FIREWALL_PEER_PUBLIC_IP:-}"
port="${LEMTEL_WIREGUARD_PORT:-51820}"

case "$role" in
  hostinger_primary)
    expected_local_address='10.253.47.1/30'
    expected_peer_address='10.253.47.2/32'
    ;;
  digitalocean_standby)
    expected_local_address='10.253.47.2/30'
    expected_peer_address='10.253.47.1/32'
    ;;
  *)
    printf 'wireguard_tunnel_status=invalid_role\n' >&2
    exit 1
    ;;
esac

for pair in \
  "peer_public_key:$peer_public_key" \
  "local_tunnel_address:$local_address" \
  "peer_tunnel_address:$peer_address" \
  "peer_endpoint:$peer_endpoint" \
  "firewall_peer_public_ip:$firewall_peer_public_ip"; do
  require_value "${pair%%:*}" "${pair#*:}"
done

if ! require_wireguard_key "$peer_public_key"; then
  printf 'wireguard_tunnel_status=invalid_peer_public_key\n' >&2
  exit 1
fi
if ! require_port "$port"; then
  printf 'wireguard_tunnel_status=invalid_port\n' >&2
  exit 1
fi
if [ "$local_address" != "$expected_local_address" ] || [ "$peer_address" != "$expected_peer_address" ]; then
  printf 'wireguard_tunnel_status=unexpected_tunnel_addresses\n' >&2
  exit 1
fi
peer_endpoint_ip="${peer_endpoint%:*}"
peer_endpoint_port="${peer_endpoint##*:}"
if ! require_ipv4 "$peer_endpoint_ip" || ! require_port "$peer_endpoint_port" || ! require_ipv4 "$firewall_peer_public_ip"; then
  printf 'wireguard_tunnel_status=invalid_peer_network\n' >&2
  exit 1
fi
if ! command -v wg >/dev/null 2>&1 || ! command -v wg-quick >/dev/null 2>&1; then
  printf 'wireguard_tunnel_status=wireguard_tools_missing\n' >&2
  exit 1
fi

private_key_path='/etc/lemtel-ha/wireguard/private.key'
if [ ! -s "$private_key_path" ]; then
  printf 'wireguard_tunnel_status=local_key_missing\n' >&2
  exit 1
fi

interface='lemtel-ha0'
config_path="/etc/wireguard/${interface}.conf"
service="wg-quick@${interface}"
if systemctl is-active --quiet "$service" || ip link show "$interface" >/dev/null 2>&1; then
  printf 'wireguard_tunnel_status=existing_active_interface_requires_separate_change\n' >&2
  exit 1
fi
if [ -e "$config_path" ]; then
  printf 'wireguard_tunnel_status=existing_configuration_requires_separate_change\n' >&2
  exit 1
fi

install -d -m 700 /etc/wireguard
umask 077
tmp_config="$(mktemp /etc/wireguard/.lemtel-ha0.conf.XXXXXX)"
cleanup() { rm -f "$tmp_config"; }
trap cleanup EXIT
cat > "$tmp_config" <<EOF
[Interface]
Address = ${local_address}
ListenPort = ${port}
PrivateKey = $(< "$private_key_path")

[Peer]
PublicKey = ${peer_public_key}
AllowedIPs = ${peer_address}
Endpoint = ${peer_endpoint}
PersistentKeepalive = 25
EOF
chmod 600 "$tmp_config"
mv "$tmp_config" "$config_path"
trap - EXIT

if ! systemctl enable --now "$service"; then
  rm -f "$config_path"
  systemctl disable "$service" >/dev/null 2>&1 || true
  printf 'wireguard_tunnel_status=service_start_failed_configuration_removed\n' >&2
  exit 1
fi

firewall_changed=false
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 | grep -qx 'Status: active'; then
  ufw allow from "$firewall_peer_public_ip" to any port "$port" proto udp comment 'Lemtel HA WireGuard peer'
  firewall_changed=true
fi

printf 'wireguard_tunnel_format=lemtel_ha_wireguard_tunnel_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'interface=%s\n' "$interface"
printf 'local_tunnel_address=%s\n' "$local_address"
printf 'peer_tunnel_address=%s\n' "$peer_address"
printf 'public_database_listener_enabled=false\n'
printf 'firewall_changed=%s\n' "$firewall_changed"
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'wireguard_tunnel_status=complete\n'
