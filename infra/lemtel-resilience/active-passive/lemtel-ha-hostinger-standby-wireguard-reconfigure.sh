#!/usr/bin/env bash
# Realigns a previously prepared Hostinger standby to the inverse tunnel topology.
# It changes only the private WireGuard interface and rolls back its former config
# if the replacement cannot start. It never starts database, Storage, runtime,
# public listeners, DNS, promotion or telephony.
set -euo pipefail

fail() {
  printf 'hostinger_standby_wireguard_reconfigure_status=%s\n' "$1" >&2
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
[ "${LEMTEL_HA_EXECUTE:-}" = 'realign_hostinger_standby_wireguard_from_do_writer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

peer_key="${LEMTEL_DO_WRITER_WIREGUARD_PUBLIC_KEY:-}"
peer_endpoint="${LEMTEL_DO_WRITER_WIREGUARD_ENDPOINT:-}"
interface='lemtel-ha0'
config_path="/etc/wireguard/${interface}.conf"
service="wg-quick@${interface}"
private_key_path='/etc/lemtel-ha/wireguard/private.key'
old_address='10.253.47.2/30'
local_address='10.253.47.1/30'
peer_address='10.253.47.2/32'
rollback_dir='/etc/lemtel-ha/rollback'

require_key "$peer_key" || fail invalid_do_writer_public_key
endpoint_ip="${peer_endpoint%:*}"
endpoint_port="${peer_endpoint##*:}"
require_ipv4 "$endpoint_ip" || fail invalid_do_writer_endpoint
[[ "$endpoint_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$endpoint_port" -le 65535 ] || fail invalid_do_writer_endpoint
command -v wg >/dev/null 2>&1 && command -v wg-quick >/dev/null 2>&1 || fail wireguard_tools_missing
[ -s "$private_key_path" ] || fail hostinger_private_key_missing
[ -s "$config_path" ] || fail existing_configuration_missing
systemctl is-active --quiet "$service" || fail existing_interface_inactive
ip -4 addr show dev "$interface" | grep -Fq "$old_address" || fail unexpected_existing_tunnel_address

install -d -m 0700 "$rollback_dir"
backup_conf="$rollback_dir/${interface}.conf.before-inverse-realign"
cp -a "$config_path" "$backup_conf"

umask 077
tmp_config="$(mktemp /etc/wireguard/.${interface}.conf.XXXXXX)"
cleanup() { rm -f "$tmp_config"; }
rollback() {
  systemctl stop "$service" >/dev/null 2>&1 || true
  cp -a "$backup_conf" "$config_path"
  systemctl start "$service" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap rollback ERR

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

systemctl stop "$service"
mv "$tmp_config" "$config_path"
systemctl start "$service"
ip -4 addr show dev "$interface" | grep -Fq "$local_address" || fail local_address_not_applied
wg show "$interface" peers | grep -qx "$peer_key" || fail peer_not_applied
trap - ERR
trap - EXIT

printf 'hostinger_standby_wireguard_reconfigure_format=lemtel_inverse_wireguard_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'former_tunnel_address_replaced=true\n'
printf 'private_tunnel_interface=healthy\n'
printf 'private_database_listener_enabled=false\n'
printf 'postgres_started=false\n'
printf 'storage_started=false\n'
printf 'runtime_started=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_standby_wireguard_reconfigure_status=complete\n'
