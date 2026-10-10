#!/usr/bin/env bash
# Root-only, transactional SSH AllowUsers update for the already-restricted Storage receiver.
set -euo pipefail

fail() {
  printf 'storage_standby_ssh_allowuser_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'allow_private_storage_receiver_ssh' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

receiver_user='lemtelstorage'
primary_tunnel_address='10.253.47.1'
required_existing_users=(lemtelbackupops lemtelbackup lemtelops)

command -v sshd >/dev/null 2>&1 || fail sshd_missing
systemctl is-active --quiet ssh || fail ssh_service_inactive
id "$receiver_user" >/dev/null 2>&1 || fail receiver_user_missing
[ "$(getent passwd "$receiver_user" | cut -d: -f7)" = '/usr/sbin/nologin' ] || fail receiver_shell_not_restricted
[ -x /usr/local/libexec/lemtel-ha-storage-rsync-receiver ] || fail receiver_command_missing
[ -f "/home/$receiver_user/.ssh/authorized_keys" ] || fail receiver_authorized_key_missing

declare -a allowuser_matches=()
while IFS= read -r match; do
  allowuser_matches+=("$match")
done < <(grep -RIH --include='sshd_config' --include='*.conf' '^[[:space:]]*AllowUsers[[:space:]]' /etc/ssh 2>/dev/null || true)

[ "${#allowuser_matches[@]}" -eq 1 ] || fail unexpected_allowusers_configuration
config_file="${allowuser_matches[0]%%:*}"
current_line="${allowuser_matches[0]#*:}"
current_line="$(printf '%s\n' "$current_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]+$//')"
case "$current_line" in
  AllowUsers\ *) ;;
  *) fail unexpected_allowusers_configuration ;;
esac
current_allowlist="${current_line#AllowUsers }"
read -r -a current_users <<< "$current_allowlist"
[ "${#current_users[@]}" -eq "${#required_existing_users[@]}" ] || fail unexpected_allowusers_configuration
for required_user in "${required_existing_users[@]}"; do
  found=false
  for current_user in "${current_users[@]}"; do
    [ "$current_user" = "$required_user" ] && found=true
  done
  [ "$found" = true ] || fail unexpected_allowusers_configuration
done
case " $current_allowlist " in
  *" $receiver_user "*|*" $receiver_user@"*) fail receiver_already_allowed ;;
esac
replacement="${current_line} ${receiver_user}@${primary_tunnel_address}"

backup_file="/root/lemtel-ha-$(basename "$config_file").allowusers.backup"
cp -p "$config_file" "$backup_file"
rollback_needed=true
rollback() {
  if [ "$rollback_needed" = true ]; then
    cp -p "$backup_file" "$config_file"
    /usr/sbin/sshd -t && systemctl reload ssh || true
  fi
}
trap rollback ERR

rewrite_file="$(mktemp "${config_file}.lemtel-ha.XXXXXX")"
awk -v original="$current_line" -v replacement="$replacement" '
  {
    trimmed = $0
    sub(/^[[:space:]]+/, "", trimmed)
    sub(/[[:space:]]+$/, "", trimmed)
    if (trimmed == original) {
      print replacement
      replacements++
    } else {
      print
    }
  }
  END { exit replacements == 1 ? 0 : 1 }
' "$config_file" > "$rewrite_file" || fail unexpected_allowusers_configuration
cat "$rewrite_file" > "$config_file"
rm -f "$rewrite_file"
/usr/sbin/sshd -t || fail sshd_configuration_invalid
systemctl reload ssh
sleep 1
systemctl is-active --quiet ssh || fail ssh_service_reload_failed
actual_line="$(/usr/sbin/sshd -T | awk '$1 == "allowusers" { $1=""; sub(/^ /, ""); value=$0 } END { print value }')"
[ "$actual_line" = "${current_allowlist} ${receiver_user}@${primary_tunnel_address}" ] || fail allowusers_effective_policy_mismatch

rollback_needed=false
rm -f "$backup_file"
printf 'storage_standby_ssh_allowuser_format=lemtel_storage_standby_ssh_allowuser_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'existing_admin_access_retained=true\n'
printf 'storage_receiver_ssh_source=wireguard_primary_only\n'
printf 'storage_receiver_shell_restricted=true\n'
printf 'storage_receiver_forced_command_required=true\n'
printf 'root_ssh_access_relaxed=false\n'
printf 'public_ssh_listener_changed=false\n'
printf 'storage_replication_started=false\n'
printf 'storage_standby_ssh_allowuser_status=complete\n'
