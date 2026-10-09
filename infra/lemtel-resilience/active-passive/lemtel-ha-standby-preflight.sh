#!/usr/bin/env bash
# Read-only DigitalOcean preflight for the Lemtel availability-first warm standby.
# This script does not install software, write files, change firewall rules, or contact telephony.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'preflight_status=root_required\n' >&2
    exit 1
  fi
}

bool() {
  if "$@" >/dev/null 2>&1; then printf true; else printf false; fi
}

listener_present() {
  local port="$1"
  if command -v ss >/dev/null 2>&1 && ss -lnt "sport = :${port}" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit(found ? 0 : 1) }'; then
    printf true
  else
    printf false
  fi
}

require_root
role="${LEMTEL_HA_ROLE:-digitalocean_standby}"

printf 'preflight_format=lemtel_standby_preflight_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'hostname=%s\n' "$(hostname -s)"
printf 'os=%s\n' "$(. /etc/os-release && printf '%s %s' "$ID" "$VERSION_ID")"
printf 'cpu_count=%s\n' "$(nproc)"
printf 'memory_megabytes=%s\n' "$(free -m | awk '/^Mem:/ {print $2}')"
printf 'root_filesystem_available_megabytes=%s\n' "$(df -Pm / | awk 'NR == 2 {print $4}')"
printf 'docker_available=%s\n' "$(bool command -v docker)"
printf 'docker_compose_available=%s\n' "$(bool docker compose version)"
printf 'wireguard_tools_available=%s\n' "$(bool command -v wg)"
printf 'ssh_service_active=%s\n' "$(bool systemctl is-active --quiet ssh)"
printf 'docker_service_active=%s\n' "$(bool systemctl is-active --quiet docker)"
printf 'postgres_listener_5432_present=%s\n' "$(listener_present 5432)"
printf 'wireguard_listener_51820_present=%s\n' "$(listener_present 51820)"
printf 'ufw_command_available=%s\n' "$(bool command -v ufw)"
printf 'nft_command_available=%s\n' "$(bool command -v nft)"
printf 'primary_hostname_resolves=%s\n' "$(bool getent ahostsv4 lemtel.avastatistic.ca)"
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'preflight_status=complete\n'
