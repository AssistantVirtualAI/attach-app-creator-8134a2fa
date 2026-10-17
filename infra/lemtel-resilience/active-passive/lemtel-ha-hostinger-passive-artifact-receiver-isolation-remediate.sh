#!/usr/bin/env bash
# Lemtel: separate GitHub's restricted artifact receiver from root-only envelopes.
# This script never applies an artifact, starts a runtime, changes a listener,
# alters DNS, promotes PostgreSQL, or performs a failover action.
set -euo pipefail

fail() {
  printf 'hostinger_passive_artifact_receiver_isolation_status=blocked\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail root_required
[[ "${LEMTEL_HA_EXECUTE:-}" == 'remediate_hostinger_passive_artifact_receiver_isolation' ]] || fail execution_acknowledgement_required
[[ "${LEMTEL_HA_ROLE:-}" == 'hostinger_standby' ]] || fail hostinger_standby_role_required

receiver_user='lemtelstorage'
receiver_home="$(getent passwd "$receiver_user" | awk -F: '{print $6}')"
[[ "$receiver_home" == '/home/lemtelstorage' && -d "$receiver_home" && ! -L "$receiver_home" ]] || fail storage_receiver_account_required
receiver_program='/usr/local/libexec/lemtel-ha-hostinger-artifact-receive'
authorized_keys="$receiver_home/.ssh/authorized_keys"
legacy_envelope_directory='/var/lib/lemtel-ha/artifacts/hostinger-received'
github_artifact_directory="$receiver_home/github-artifacts"

[[ -f "$receiver_program" && ! -L "$receiver_program" ]] || fail existing_receiver_program_required
[[ "$(stat -c '%u:%g:%a:%h' "$receiver_program")" == '0:0:755:1' ]] || fail existing_receiver_program_ownership_invalid
grep -Fqx "artifact_directory='$legacy_envelope_directory'" "$receiver_program" || fail existing_receiver_program_unrecognized
grep -Fq 'artifact_receiver_status=stored' "$receiver_program" || fail existing_receiver_program_unrecognized
[[ -f "$authorized_keys" && ! -L "$authorized_keys" ]] || fail existing_receiver_authorization_required
grep -Fq 'command="/usr/local/libexec/lemtel-ha-hostinger-artifact-receive"' "$authorized_keys" || fail existing_receiver_authorization_unrecognized
[[ -d "$legacy_envelope_directory" && ! -L "$legacy_envelope_directory" ]] || fail legacy_envelope_directory_required
[[ "$(stat -c '%u:%g:%a' "$legacy_envelope_directory")" == '0:0:700' ]] || fail legacy_envelope_directory_ownership_invalid

if [[ -e "$github_artifact_directory" || -L "$github_artifact_directory" ]]; then
  [[ -d "$github_artifact_directory" && ! -L "$github_artifact_directory" ]] || fail github_artifact_directory_invalid
  [[ "$(stat -c '%U:%G:%a' "$github_artifact_directory")" == "$receiver_user:$receiver_user:700" ]] || fail github_artifact_directory_ownership_invalid
else
  install -d -o "$receiver_user" -g "$receiver_user" -m 0700 "$github_artifact_directory"
fi

candidate="${receiver_program}.new.$$"
cleanup() { rm -f "$candidate"; }
trap cleanup EXIT HUP INT TERM
cat > "$candidate" <<'RECEIVER'
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

artifact_directory='/home/lemtelstorage/github-artifacts'
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
chown root:root "$candidate"
chmod 0755 "$candidate"
[[ "$(stat -c '%u:%g:%a:%h' "$candidate")" == '0:0:755:1' ]] || fail candidate_receiver_program_invalid
sshd -t || fail sshd_configuration_invalid
mv -f "$candidate" "$receiver_program"
trap - EXIT HUP INT TERM

printf 'hostinger_passive_artifact_receiver_isolation_format=lemtel_hostinger_passive_artifact_receiver_isolation_v1\n'
printf 'standby=hostinger_private_standby\n'
printf 'github_artifact_directory_isolated=true\n'
printf 'legacy_runtime_envelope_directory_unchanged=true\n'
printf 'receiver_authorization_preserved=true\n'
printf 'artifact_runtime_applied=false\n'
printf 'runtime_changed=false\n'
printf 'dns_changed=false\n'
printf 'postgres_promoted=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'hostinger_passive_artifact_receiver_isolation_status=complete\n'
