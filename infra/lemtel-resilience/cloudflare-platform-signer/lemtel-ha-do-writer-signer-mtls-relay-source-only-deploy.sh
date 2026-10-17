#!/usr/bin/env bash
# Root-only, source-only staging of the Lemtel signer mTLS relay on the DO writer.
# It copies an already package-verified release atomically. It never installs a
# systemd unit, writes relay configuration, or creates a socket.
set -euo pipefail
set +x
export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset BASH_ENV CDPATH ENV
IFS=$' \t\n'
umask 077

fail() {
  printf 'do_signer_mtls_relay_source_only_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(/usr/bin/id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly INSTALL_TOKEN='install_do_signer_mtls_relay_source_only'
readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'
readonly INSTALL_PARENT='/opt/lemtel-ha'
readonly INSTALL_DIRECTORY='/opt/lemtel-ha/cloudflare-platform-signer'
readonly LOCK_DIRECTORY='/opt/lemtel-ha/.cloudflare-platform-signer-stage.lock'
readonly RELAY_SOURCE='lemtel-signer-mtls-relay.py'
readonly CONTRACT_SOURCE='mtls-relay-contract.json'
readonly UNIT_SOURCE='systemd/lemtel-signer-mtls-relay.service'
readonly RELAY_SHA256='b63f7c6479e9eb6f1b5b9e2153c63388d930b516f08f5a1eb80fcad8c04dc04a'
readonly CONTRACT_SHA256='ce1c9b0a2ca36d457e3e0be7af3d608ed16c8aaf4253a2fa413f1931d343c098'
readonly UNIT_SHA256='b36ccd3c19410622dbd59d2eb7aa4d8b0a2c230d7764cb12b775d4cde873a631'
readonly -a SOURCE_FILES=(
  "$RELAY_SOURCE"
  "$CONTRACT_SOURCE"
  "$UNIT_SOURCE"
)

[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required
[ "${LEMTEL_HA_EXECUTE:-}" = "$INSTALL_TOKEN" ] || fail execution_token_required

script_directory="$(cd -- "$(dirname -- "$0")" && pwd -P)"
staging_directory=''
lock_held='false'

cleanup() {
  if [ -n "$staging_directory" ] && [ -d "$staging_directory" ] && [ ! -L "$staging_directory" ]; then
    rm -rf -- "$staging_directory" >/dev/null 2>&1 || true
  fi
  if [ "$lock_held" = 'true' ] && [ -d "$LOCK_DIRECTORY" ] && [ ! -L "$LOCK_DIRECTORY" ]; then
    rmdir -- "$LOCK_DIRECTORY" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

secure_directory() {
  local path="$1" expected_mode="$2" metadata
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  metadata="$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null)" || return 1
  [ "$metadata" = "0:0:${expected_mode}" ]
}

secure_regular_root() {
  local path="$1" expected_mode="$2" metadata
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  metadata="$(stat -c '%u:%g:%a:%h' -- "$path" 2>/dev/null)" || return 1
  [ "$metadata" = "0:0:${expected_mode}:1" ]
}

secure_source_file() {
  local path="$1" metadata owner group mode links mode_value
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  metadata="$(stat -c '%u:%g:%a:%h' -- "$path" 2>/dev/null)" || return 1
  IFS=: read -r owner group mode links <<< "$metadata"
  [ "$owner" = '0' ] && [ "$group" = '0' ] && [ "$links" = '1' ] || return 1
  case "$mode" in *[!0-7]*|'') return 1;; esac
  mode_value=$((8#$mode))
  (( (mode_value & 8#022) == 0 ))
}

sha256_matches() {
  local path="$1" expected="$2" actual
  actual="$(sha256sum -- "$path" 2>/dev/null)" || return 1
  actual="${actual%%[[:space:]]*}"
  [ "$actual" = "$expected" ]
}

ensure_directory() {
  local parent="$1" path="$2" parent_mode="$3" mode="$4" reason="$5"
  secure_directory "$parent" "$parent_mode" || fail "$reason"
  if [ -e "$path" ] || [ -L "$path" ]; then
    secure_directory "$path" "$mode" || fail "$reason"
  else
    mkdir -m "$mode" -- "$path" >/dev/null 2>&1 || fail "$reason"
    chown root:root -- "$path" >/dev/null 2>&1 || fail "$reason"
    secure_directory "$path" "$mode" || fail "$reason"
  fi
}

assert_preexisting_mtls_credential_sources() {
  secure_directory "$CREDENTIALS_DIRECTORY" '700' || fail credential_directory_security_invalid
  secure_regular_root "${CREDENTIALS_DIRECTORY}/client-cert.pem.cred" '600' || fail client_certificate_credential_security_invalid
  secure_regular_root "${CREDENTIALS_DIRECTORY}/client-key.pem.cred" '600' || fail client_key_credential_security_invalid
}

assert_verified_source() {
  local source="$1" digest="$2"
  secure_source_file "$script_directory/$source" || fail source_file_security_invalid
  sha256_matches "$script_directory/$source" "$digest" || fail source_digest_mismatch
}

assert_all_verified_sources() {
  secure_directory "$script_directory" '700' || fail source_directory_security_invalid
  assert_verified_source "$RELAY_SOURCE" "$RELAY_SHA256"
  assert_verified_source "$CONTRACT_SOURCE" "$CONTRACT_SHA256"
  assert_verified_source "$UNIT_SOURCE" "$UNIT_SHA256"
}

assert_release_tree() {
  local entry
  secure_directory "$INSTALL_DIRECTORY" '750' || fail installed_release_security_invalid
  secure_regular_root "$INSTALL_DIRECTORY/$RELAY_SOURCE" '750' || fail installed_relay_security_invalid
  secure_regular_root "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" '640' || fail installed_contract_security_invalid
  secure_directory "$INSTALL_DIRECTORY/systemd" '750' || fail installed_unit_directory_security_invalid
  secure_regular_root "$INSTALL_DIRECTORY/$UNIT_SOURCE" '640' || fail installed_unit_security_invalid
  sha256_matches "$INSTALL_DIRECTORY/$RELAY_SOURCE" "$RELAY_SHA256" || fail installed_relay_digest_mismatch
  sha256_matches "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" "$CONTRACT_SHA256" || fail installed_contract_digest_mismatch
  sha256_matches "$INSTALL_DIRECTORY/$UNIT_SOURCE" "$UNIT_SHA256" || fail installed_unit_digest_mismatch
  shopt -s nullglob dotglob
  local -a root_entries=("$INSTALL_DIRECTORY"/*)
  local -a unit_entries=("$INSTALL_DIRECTORY/systemd"/*)
  shopt -u nullglob dotglob
  [ "${#root_entries[@]}" -eq 3 ] || fail installed_release_contents_invalid
  for entry in "${root_entries[@]}"; do
    case "$entry" in
      "$INSTALL_DIRECTORY/$RELAY_SOURCE"|"$INSTALL_DIRECTORY/$CONTRACT_SOURCE"|"$INSTALL_DIRECTORY/systemd") ;;
      *) fail installed_release_contents_invalid ;;
    esac
  done
  [ "${#unit_entries[@]}" -eq 1 ] && [ "${unit_entries[0]}" = "$INSTALL_DIRECTORY/$UNIT_SOURCE" ] || fail installed_unit_contents_invalid
}

stage_release() {
  staging_directory="$(mktemp -d "$INSTALL_PARENT/.cloudflare-platform-signer.stage.XXXXXX")" || fail staging_directory_create_failed
  secure_directory "$staging_directory" '700' || fail staging_directory_security_invalid
  install -d -o root -g root -m 0750 "$staging_directory/systemd" || fail staging_directory_create_failed
  install -o root -g root -m 0750 "$script_directory/$RELAY_SOURCE" "$staging_directory/$RELAY_SOURCE" || fail staging_copy_failed
  install -o root -g root -m 0640 "$script_directory/$CONTRACT_SOURCE" "$staging_directory/$CONTRACT_SOURCE" || fail staging_copy_failed
  install -o root -g root -m 0640 "$script_directory/$UNIT_SOURCE" "$staging_directory/$UNIT_SOURCE" || fail staging_copy_failed
  secure_regular_root "$staging_directory/$RELAY_SOURCE" '750' || fail staging_relay_security_invalid
  secure_regular_root "$staging_directory/$CONTRACT_SOURCE" '640' || fail staging_contract_security_invalid
  secure_directory "$staging_directory/systemd" '750' || fail staging_unit_directory_security_invalid
  secure_regular_root "$staging_directory/$UNIT_SOURCE" '640' || fail staging_unit_security_invalid
  sha256_matches "$staging_directory/$RELAY_SOURCE" "$RELAY_SHA256" || fail staging_relay_digest_mismatch
  sha256_matches "$staging_directory/$CONTRACT_SOURCE" "$CONTRACT_SHA256" || fail staging_contract_digest_mismatch
  sha256_matches "$staging_directory/$UNIT_SOURCE" "$UNIT_SHA256" || fail staging_unit_digest_mismatch
}

assert_preexisting_mtls_credential_sources
assert_all_verified_sources
secure_directory '/opt' '755' || fail opt_directory_security_invalid
ensure_directory '/opt' "$INSTALL_PARENT" '755' '750' install_parent_security_invalid
mkdir -m 0700 -- "$LOCK_DIRECTORY" >/dev/null 2>&1 || fail concurrent_or_stale_install_lock
lock_held='true'

if [ -e "$INSTALL_DIRECTORY" ] || [ -L "$INSTALL_DIRECTORY" ]; then
  assert_release_tree
  release_state='already_staged_verified'
else
  stage_release
  mv --no-target-directory -- "$staging_directory" "$INSTALL_DIRECTORY" || fail atomic_release_commit_failed
  staging_directory=''
  assert_release_tree
  release_state='staged_atomically'
fi

printf 'do_signer_mtls_relay_source_only_deploy_format=lemtel_do_signer_mtls_relay_source_only_v2\n'
printf 'writer=digitalocean_writer\n'
printf 'mtls_credential_sources_preexisting_root_only=true\n'
printf 'credential_values_read=false\n'
printf 'credential_values_emitted=false\n'
printf 'source_release_verified=true\n'
printf 'release_state=%s\n' "$release_state"
printf 'relay_configuration_created=false\n'
printf 'relay_source_staged=true\n'
printf 'systemd_unit_staged_not_installed=true\n'
printf 'systemd_daemon_reloaded=false\n'
printf 'service_enabled=false\n'
printf 'service_started=false\n'
printf 'timer_enabled=false\n'
printf 'runtime_started=false\n'
printf 'routes_changed=false\n'
printf 'provider_contacted=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'business_data_read=false\n'
printf 'do_signer_mtls_relay_source_only_deploy_status=complete\n'
