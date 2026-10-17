#!/usr/bin/env bash
# Root-only, read-only diagnostic for local node-publication key state.
# It never reads key contents, writes files, contacts a network service, or
# configures publication, timers, runtime, fencing, routing or telephony.
set -euo pipefail
set +x

fail() {
  printf 'node_publication_key_state_diagnostic_status=blocked\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 78
}

[ "$(id -u)" -eq 0 ] || fail root_required
case "${LEMTEL_NODE_KEY_DIAGNOSTIC_ROLE:-}" in do_writer|hostinger_standby) ;; *) fail node_role_required ;; esac

config='/etc/lemtel-node-publication'
state='/var/lib/lemtel-node-publication'
keys="$config/keys.json"

directory_state() {
  local path="$1" mode
  if [ ! -e "$path" ]; then printf 'absent'; return; fi
  if [ ! -d "$path" ] || [ -L "$path" ]; then printf 'invalid'; return; fi
  if [ "$(stat -c '%u:%g' "$path")" != '0:0' ]; then printf 'insecure'; return; fi
  mode="$(stat -c '%a' "$path")"
  if [ $((8#$mode & 022)) -ne 0 ]; then printf 'insecure'; return; fi
  printf 'secure'
}

file_state() {
  local path="$1" mode
  if [ ! -e "$path" ]; then printf 'absent'; return; fi
  if [ ! -f "$path" ] || [ -L "$path" ]; then printf 'invalid'; return; fi
  if [ "$(stat -c '%u:%g' "$path")" != '0:0' ]; then printf 'insecure'; return; fi
  mode="$(stat -c '%a' "$path")"
  if [ $((8#$mode & 077)) -ne 0 ]; then printf 'insecure'; return; fi
  printf 'secure'
}

entry_count() {
  local path="$1"
  [ -d "$path" ] && [ ! -L "$path" ] || { printf '0'; return; }
  find "$path" -mindepth 1 -maxdepth 1 -printf '.' 2>/dev/null | wc -c | tr -d ' '
}

config_state="$(directory_state "$config")"
state_state="$(directory_state "$state")"
keys_state="$(file_state "$keys")"
config_entries="$(entry_count "$config")"
state_entries="$(entry_count "$state")"

printf 'node_publication_key_state_diagnostic_format=lemtel_node_publication_key_state_diagnostic_v1\n'
printf 'node_role=%s\n' "$LEMTEL_NODE_KEY_DIAGNOSTIC_ROLE"
printf 'config_directory_state=%s\n' "$config_state"
printf 'state_directory_state=%s\n' "$state_state"
printf 'keys_file_state=%s\n' "$keys_state"
printf 'config_entry_count=%s\n' "$config_entries"
printf 'state_entry_count=%s\n' "$state_entries"
printf 'key_material_read=false\n'
printf 'filesystem_mutation=false\n'
printf 'network_access=false\n'
printf 'publication_configured=false\n'
printf 'publication_executed=false\n'
printf 'service_installed=false\n'
printf 'timer_enabled=false\n'
printf 'provider_contacted=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'node_publication_key_state_diagnostic_status=complete\n'
