#!/usr/bin/env bash
# Root-only remediation: permit the account shell needed to launch the SSH forced rsync receiver.
set -euo pipefail

fail() {
  printf 'storage_standby_receiver_shell_remediate_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'remediate_private_storage_receiver_shell' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

receiver_user='lemtelstorage'
receiver_home="/home/$receiver_user"
receiver_script='/usr/local/libexec/lemtel-ha-storage-rsync-receiver'
authorized_keys="$receiver_home/.ssh/authorized_keys"
primary_tunnel_address='10.253.47.1'

id "$receiver_user" >/dev/null 2>&1 || fail receiver_user_missing
[ "$(getent passwd "$receiver_user" | cut -d: -f6)" = "$receiver_home" ] || fail receiver_home_mismatch
[ "$(getent passwd "$receiver_user" | cut -d: -f7)" = '/usr/sbin/nologin' ] || fail receiver_shell_not_remediable
[ -x "$receiver_script" ] || fail receiver_command_missing
[ -f "$authorized_keys" ] || fail receiver_authorized_key_missing
grep -Fq "from=\"$primary_tunnel_address\",restrict,command=\"$receiver_script\"" "$authorized_keys" || fail receiver_key_not_restricted

usermod --shell /bin/sh "$receiver_user"
[ "$(getent passwd "$receiver_user" | cut -d: -f7)" = '/bin/sh' ] || fail receiver_shell_update_failed

printf 'storage_standby_receiver_shell_remediate_format=lemtel_storage_receiver_shell_remediate_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'storage_receiver_shell=forced_command_runtime_only\n'
printf 'storage_receiver_source=wireguard_primary_only\n'
printf 'storage_receiver_forced_command_required=true\n'
printf 'storage_receiver_interactive_access_enabled=false\n'
printf 'root_ssh_access_relaxed=false\n'
printf 'public_ssh_listener_changed=false\n'
printf 'storage_replication_started=false\n'
printf 'storage_standby_receiver_shell_remediate_status=complete\n'
