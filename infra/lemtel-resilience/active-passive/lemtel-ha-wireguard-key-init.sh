#!/usr/bin/env bash
# Creates one local WireGuard keypair for the approved Lemtel HA tunnel.
# It does not create an interface, open a firewall port, start a service, or contact telephony.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'wireguard_key_status=root_required\n' >&2
    exit 1
  fi
}

require_role() {
  case "$1" in
    hostinger_primary|digitalocean_standby) ;;
    *)
      printf 'wireguard_key_status=invalid_role\n' >&2
      exit 1
      ;;
  esac
}

require_port() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) [ "$1" -le 65535 ] ;;
  esac
}

require_root
role="${LEMTEL_HA_ROLE:-}"
port="${LEMTEL_WIREGUARD_PORT:-51820}"
require_role "$role"
if ! require_port "$port"; then
  printf 'wireguard_key_status=invalid_port\n' >&2
  exit 1
fi

if ! command -v wg >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends wireguard-tools
fi

key_dir='/etc/lemtel-ha/wireguard'
private_key_path="$key_dir/private.key"
public_key_path="$key_dir/public.key"
install -d -m 700 "$key_dir"

if [ -e "$private_key_path" ] && [ ! -s "$private_key_path" ]; then
  printf 'wireguard_key_status=existing_private_key_empty\n' >&2
  exit 1
fi
if [ ! -e "$private_key_path" ] && [ -e "$public_key_path" ]; then
  printf 'wireguard_key_status=public_key_without_private_key\n' >&2
  exit 1
fi

if [ ! -e "$private_key_path" ]; then
  umask 077
  wg genkey > "$private_key_path"
fi
chmod 600 "$private_key_path"

expected_public_key="$(wg pubkey < "$private_key_path")"
if [ -e "$public_key_path" ] && [ "$(tr -d '\r\n' < "$public_key_path")" != "$expected_public_key" ]; then
  printf 'wireguard_key_status=existing_public_key_mismatch\n' >&2
  exit 1
fi
printf '%s\n' "$expected_public_key" > "$public_key_path"
chmod 600 "$public_key_path"

printf 'wireguard_key_format=lemtel_ha_wireguard_key_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'wireguard_port=%s\n' "$port"
printf 'wireguard_public_key=%s\n' "$expected_public_key"
printf 'wireguard_interface_started=false\n'
printf 'firewall_changed=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'wireguard_key_status=complete\n'
