#!/usr/bin/env bash
# Root-only setup of an SSH-restricted rsync receiver on the Hostinger standby.
# It accepts Storage files only from the current DigitalOcean writer over WireGuard.
set -euo pipefail

fail() {
  printf 'hostinger_storage_receiver_bootstrap_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'bootstrap_hostinger_private_storage_receiver' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

writer_tunnel_address='10.253.47.2'
receiver_user='lemtelstorage'
receiver_home="/home/$receiver_user"
receiver_dir="$receiver_home/storage-current"
receiver_script='/usr/local/libexec/lemtel-ha-hostinger-storage-rsync-receiver'
writer_public_key="${LEMTEL_HA_STORAGE_WRITER_PUBLIC_KEY:-}"

[[ "$writer_public_key" != *$'\n'* && "$writer_public_key" != *$'\r'* ]] || fail invalid_writer_public_key
case "$writer_public_key" in
  ssh-ed25519\ *) ;;
  *) fail invalid_writer_public_key ;;
esac

command -v rsync >/dev/null 2>&1 || fail rsync_missing
command -v sshd >/dev/null 2>&1 || fail sshd_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq '10.253.47.1' || fail standby_tunnel_address_missing

if id "$receiver_user" >/dev/null 2>&1; then
  [ "$(getent passwd "$receiver_user" | cut -d: -f6)" = "$receiver_home" ] || fail receiver_home_mismatch
else
  useradd --system --user-group --create-home --home-dir "$receiver_home" --shell /bin/sh "$receiver_user"
fi

# An AllowUsers policy must already include this restricted receiver. This
# avoids weakening SSH policy silently. Default sshd installations have no
# AllowUsers restriction and need no change.
allow_users="$(sshd -T | awk '$1 == "allowusers" { print $2 }')"
if [ -n "$allow_users" ]; then
  case " $allow_users " in *" $receiver_user "*) ;; *) fail receiver_not_allowed_by_sshd_policy ;; esac
fi

install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$receiver_dir"
install -d -o root -g root -m 0755 /usr/local/libexec
cat > "$receiver_script" <<'RECEIVER'
#!/bin/sh
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
case "$3" in -*) ;; *) exit 126 ;; esac
case "$3" in *--sender*|*--daemon*|*--protect-args*) exit 126 ;; esac
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
forced_key="from=\"$writer_tunnel_address\",restrict,command=\"$receiver_script\" $writer_public_key"
if [ -e "$authorized_keys" ] && ! grep -Fxq "$forced_key" "$authorized_keys"; then
  fail existing_authorized_key_mismatch
fi
printf '%s\n' "$forced_key" > "$authorized_keys"
chown "$receiver_user:$receiver_user" "$authorized_keys"
chmod 0600 "$authorized_keys"

printf 'hostinger_storage_receiver_bootstrap_format=lemtel_hostinger_storage_receiver_v1\n'
printf 'declared_role=hostinger_standby\n'
printf 'storage_receiver_source=wireguard_writer_only\n'
printf 'storage_receiver_forced_command=true\n'
printf 'storage_delete_propagation_enabled=false\n'
printf 'storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_storage_receiver_bootstrap_status=complete\n'
