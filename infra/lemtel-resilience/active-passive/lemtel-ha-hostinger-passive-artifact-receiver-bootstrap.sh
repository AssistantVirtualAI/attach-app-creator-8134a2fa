#!/usr/bin/env bash
# Lemtel: bootstrap the passive Hostinger immutable-artifact receiver.
# This script never applies an artifact, changes runtime containers, publishes ports,
# alters DNS, or promotes PostgreSQL. It only configures a forced SSH command that
# verifies and stores a streamed archive by checksum.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'hostinger_passive_artifact_receiver_status=requires_root' >&2
  exit 1
fi

if [[ "${LEMTEL_HA_EXECUTE:-}" != 'bootstrap_hostinger_passive_artifact_receiver' ]]; then
  echo 'hostinger_passive_artifact_receiver_status=execution_acknowledgement_required' >&2
  exit 1
fi

if [[ "${LEMTEL_HA_ROLE:-}" != 'hostinger_standby' ]]; then
  echo 'hostinger_passive_artifact_receiver_status=hostinger_standby_role_required' >&2
  exit 1
fi

public_key_file="${LEMTEL_HA_ARTIFACT_DEPLOY_PUBLIC_KEY_FILE:-}"
if [[ -z "$public_key_file" || ! -r "$public_key_file" ]]; then
  echo 'hostinger_passive_artifact_receiver_status=deploy_public_key_file_required' >&2
  exit 1
fi

public_key="$(tr -d '\r\n' < "$public_key_file")"
if ! printf '%s\n' "$public_key" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( [^[:space:]]+)?$'; then
  echo 'hostinger_passive_artifact_receiver_status=invalid_deploy_public_key' >&2
  exit 1
fi

receiver_user='lemtelstorage'
receiver_home="$(getent passwd "$receiver_user" | awk -F: '{print $6}')"
if [[ -z "$receiver_home" || ! -d "$receiver_home" ]]; then
  echo 'hostinger_passive_artifact_receiver_status=storage_receiver_account_required' >&2
  exit 1
fi

receiver_program='/usr/local/libexec/lemtel-ha-hostinger-artifact-receive'
artifact_directory='/var/lib/lemtel-ha/artifacts/hostinger-received'
authorized_keys="$receiver_home/.ssh/authorized_keys"
forced_key="restrict,command=\"$receiver_program\" $public_key lemtel-github-hostinger-artifact"

install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$receiver_home/.ssh"
touch "$authorized_keys"
chown "$receiver_user:$receiver_user" "$authorized_keys"
chmod 0600 "$authorized_keys"

install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$artifact_directory"
install -d -o root -g root -m 0755 /usr/local/libexec

cat > "$receiver_program" <<'RECEIVER'
#!/bin/sh
# Restricted entrypoint: only accepts `receive <sha256>` over SSH stdin.
set -eu

command=${SSH_ORIGINAL_COMMAND:-}
case "$command" in
  'receive '*) expected_sha=${command#receive } ;;
  *) echo 'artifact_receiver_status=unsupported_command' >&2; exit 64 ;;
esac

if ! printf '%s\n' "$expected_sha" | grep -Eq '^[a-f0-9]{64}$'; then
  echo 'artifact_receiver_status=invalid_sha256' >&2
  exit 64
fi

artifact_directory='/var/lib/lemtel-ha/artifacts/hostinger-received'
temporary_file=$(mktemp "$artifact_directory/.incoming.XXXXXXXX")
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM
umask 077
cat > "$temporary_file"
actual_sha=$(sha256sum "$temporary_file" | awk '{print $1}')
if [ "$actual_sha" != "$expected_sha" ]; then
  echo 'artifact_receiver_status=checksum_mismatch' >&2
  exit 65
fi

chmod 0600 "$temporary_file"
mv -f "$temporary_file" "$artifact_directory/$expected_sha.tgz"
printf '%s\n' "$expected_sha" > "$artifact_directory/.current.sha256.new"
chmod 0600 "$artifact_directory/.current.sha256.new"
mv -f "$artifact_directory/.current.sha256.new" "$artifact_directory/current.sha256"
printf 'artifact_receiver_status=stored\n'
printf 'artifact_runtime_applied=false\n'
RECEIVER
chmod 0755 "$receiver_program"

if ! grep -Fqx "$forced_key" "$authorized_keys"; then
  printf '%s\n' "$forced_key" >> "$authorized_keys"
fi

sshd -t
printf 'hostinger_passive_artifact_receiver_status=complete\n'
printf 'runtime_changed=false\n'
printf 'dns_changed=false\n'
printf 'postgres_promoted=false\n'
