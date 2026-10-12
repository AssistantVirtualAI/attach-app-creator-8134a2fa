#!/usr/bin/env bash
# Enables only the Hostinger-standby UDP ingress required by the existing DO
# WireGuard interface. It never opens a broad port and never touches database,
# Storage, runtime, DNS, promotion or telephony.
set -euo pipefail

fail() {
  printf 'do_writer_wireguard_ingress_status=%s\n' "$1" >&2
  exit 1
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

listener_present() {
  ss -H -lun | awk '{print $5}' | grep -Eq "(:|\])${listen_port}$"
}

ufw_rule_present() {
  ufw status 2>/dev/null | grep -F "$standby_public_ip" | grep -F "$listen_port" | grep -qi udp
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'enable_hostinger_standby_wireguard_ingress_on_do_writer' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

standby_public_ip="${LEMTEL_HOSTINGER_STANDBY_PUBLIC_IP:-}"
interface='lemtel-ha0'
service="wg-quick@${interface}"
expected_address='10.253.47.2/30'

require_ipv4 "$standby_public_ip" || fail invalid_hostinger_standby_public_ip
command -v wg >/dev/null 2>&1 || fail wireguard_tools_missing
command -v ufw >/dev/null 2>&1 || fail ufw_missing
systemctl is-active --quiet "$service" || fail writer_tunnel_inactive
ip -4 addr show dev "$interface" | grep -Fq "$expected_address" || fail unexpected_writer_tunnel_address
peer_count="$(wg show "$interface" peers | sed '/^$/d' | wc -l)"
[ "$peer_count" = 1 ] || fail expected_one_hostinger_peer
listen_port="$(wg show "$interface" listen-port)"
[[ "$listen_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$listen_port" -le 65535 ] || fail invalid_writer_listen_port
ufw status 2>/dev/null | head -1 | grep -qx 'Status: active' || fail ufw_not_active

firewall_added=false
completed=false
rollback() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$completed" = false ]; then
    systemctl restart "$service" >/dev/null 2>&1 || true
    if [ "$firewall_added" = true ]; then
      ufw --force delete allow from "$standby_public_ip" to any port "$listen_port" proto udp >/dev/null 2>&1 || true
    fi
    printf 'do_writer_wireguard_ingress_rollback_attempted=true\n' >&2
  fi
  exit "$status"
}
trap rollback EXIT

if ! ufw_rule_present; then
  ufw allow from "$standby_public_ip" to any port "$listen_port" proto udp comment 'Lemtel HA Hostinger standby' >/dev/null
  firewall_added=true
fi
ufw_rule_present || fail narrow_hostinger_udp_rule_not_present

# Recreate only the existing private tunnel socket so it accepts the standby's
# keepalive packets. The public Supabase runtime does not depend on this unit.
systemctl restart "$service"
listener_present || fail writer_udp_listener_not_present
for _ in $(seq 1 30); do
  handshake="$(wg show "$interface" latest-handshakes | awk 'NR == 1 {print $2}')"
  [ "${handshake:-0}" -gt 0 ] && break
  sleep 2
done
[ "${handshake:-0}" -gt 0 ] || fail hostinger_handshake_missing

completed=true
printf 'do_writer_wireguard_ingress_format=lemtel_inverse_wireguard_ingress_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'narrow_hostinger_udp_rule_present=true\n'
printf 'writer_udp_listener_present=true\n'
printf 'wireguard_handshake_verified=true\n'
printf 'firewall_added=%s\n' "$firewall_added"
printf 'database_changed=false\n'
printf 'storage_changed=false\n'
printf 'runtime_changed=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_wireguard_ingress_status=complete\n'
