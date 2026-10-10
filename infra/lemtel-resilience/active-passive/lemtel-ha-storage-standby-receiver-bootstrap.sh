#!/usr/bin/env bash
# Root-only setup of an SSH-restricted rsync receiver for filesystem Storage on the DigitalOcean standby.
set -euo pipefail

fail() {
  printf 'storage_standby_receiver_bootstrap_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'bootstrap_private_storage_receiver' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

primary_tunnel_address='10.253.47.1'
receiver_user='lemtelstorage'
receiver_home="/home/$receiver_user"
receiver_dir="$receiver_home/storage-current"
receiver_script='/usr/local/libexec/lemtel-ha-storage-rsync-receiver'
primary_public_key="${LEMTEL_HA_STORAGE_PRIMARY_PUBLIC_KEY:-}"

[[ "$primary_public_key" != *$'\n'* && "$primary_public_key" != *$'\r'* ]] || fail invalid_primary_public_key
case "$primary_public_key" in
  ssh-ed25519\ *) ;;
  *) fail invalid_primary_public_key ;;
esac

command -v rsync >/dev/null 2>&1 || fail rsync_missing
command -v sshd >/dev/null 2>&1 || fail sshd_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

if id "$receiver_user" >/dev/null 2>&1; then
  [ "$(getent passwd "$receiver_user" | cut -d: -f6)" = "$receiver_home" ] || fail receiver_home_mismatch
else
  # OpenSSH executes a forced command through the account shell. The key remains
  # source-pinned and `restrict` + the forced receiver deny interactive use.
  useradd --system --user-group --create-home --home-dir "$receiver_home" --shell /bin/sh "$receiver_user"
fi

install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$receiver_dir"
install -d -o root -g root -m 0755 /usr/local/libexec
cat > "$receiver_script" <<'RECEIVER'
#!/bin/sh
# Accept only a local rsync push into the fixed standby Storage directory.
set -eu
receiver_dir='/home/lemtelstorage/storage-current/'
command_line=${SSH_ORIGINAL_COMMAND-}
set -f
old_ifs=$IFS
IFS=' '
set -- $command_line
IFS=$old_ifs

[ "$1" = rsync ] || exit 126
[ "$2" = --server ] || exit 126
case "$3" in
  -*) ;;
  *) exit 126 ;;
esac
case "$3" in
  *--sender*|*--daemon*|*--protect-args*) exit 126 ;;
esac
# The primary script uses exactly one of these receiver command shapes. Do not
# forward SSH_ORIGINAL_COMMAND verbatim: each option and destination is pinned.
if [ "$#" -eq 8 ] \
  && [ "$4" = --partial-dir ] \
  && [ "$5" = .lemtel-ha-partial ] \
  && [ "$6" = --delay-updates ] \
  && [ "$7" = . ] \
  && [ "$8" = "$receiver_dir" ]; then
  exec /usr/bin/rsync --server "$3" --partial-dir .lemtel-ha-partial --delay-updates . "$receiver_dir"
fi

if [ "$#" -eq 6 ] \
  && [ "$4" = --delay-updates ] \
  && [ "$5" = . ] \
  && [ "$6" = "${receiver_dir}.lemtel-ha-manifest.current.sha256" ]; then
  exec /usr/bin/rsync --server "$3" --delay-updates . "${receiver_dir}.lemtel-ha-manifest.current.sha256"
fi

exit 126
RECEIVER
chmod 0755 "$receiver_script"
chown root:root "$receiver_script"

authorized_keys="$receiver_home/.ssh/authorized_keys"
install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$receiver_home/.ssh"
forced_key="from=\"$primary_tunnel_address\",restrict,command=\"$receiver_script\" $primary_public_key"
if [ -e "$authorized_keys" ] && ! grep -Fxq "$forced_key" "$authorized_keys"; then
  fail existing_authorized_key_mismatch
fi
printf '%s\n' "$forced_key" > "$authorized_keys"
chown "$receiver_user:$receiver_user" "$authorized_keys"
chmod 0600 "$authorized_keys"

printf 'storage_standby_receiver_bootstrap_format=lemtel_storage_standby_receiver_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'storage_receiver_user=restricted\n'
printf 'storage_receiver_path=prepared\n'
printf 'storage_receiver_source=wireguard_primary_only\n'
printf 'storage_receiver_forced_command=true\n'
printf 'storage_replication_started=false\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'storage_standby_receiver_bootstrap_status=complete\n'
