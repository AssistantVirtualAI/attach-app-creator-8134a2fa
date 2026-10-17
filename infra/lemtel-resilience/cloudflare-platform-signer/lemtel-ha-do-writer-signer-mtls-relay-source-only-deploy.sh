#!/usr/bin/env bash
# Root-only, source-only installation of the Lemtel signer mTLS relay on the DO writer.
# It reads credential metadata only; it never creates, reads, transports, or emits credential values.
# It does not reload systemd or enable/start any unit.
set -euo pipefail
set +x

fail() {
  printf 'do_signer_mtls_relay_source_only_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly INSTALL_TOKEN='install_do_signer_mtls_relay_source_only'
readonly INSTALL_DIRECTORY='/opt/lemtel-ha/cloudflare-platform-signer'
readonly UNIT_DIRECTORY='/etc/systemd/system'
readonly UNIT_NAME='lemtel-signer-mtls-relay.service'
readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'
readonly RELAY_SOURCE='lemtel-signer-mtls-relay.py'
readonly CONTRACT_SOURCE='mtls-relay-contract.json'
readonly UNIT_SOURCE='systemd/lemtel-signer-mtls-relay.service'
readonly -a SOURCE_FILES=(
  "$RELAY_SOURCE"
  "$CONTRACT_SOURCE"
  "$UNIT_SOURCE"
)

[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required
[ "${LEMTEL_HA_EXECUTE:-}" = "$INSTALL_TOKEN" ] || fail execution_token_required

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"

secure_directory() {
  local path="$1" expected_mode="$2"
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  [ "$(stat -c '%u:%g:%a' -- "$path")" = "0:0:${expected_mode}" ]
}

secure_regular_root() {
  local path="$1" expected_mode="$2"
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  [ "$(stat -c '%u:%g:%a' -- "$path")" = "0:0:${expected_mode}" ]
}

assert_preexisting_mtls_credential_sources() {
  secure_directory "$CREDENTIALS_DIRECTORY" '700' || fail credential_directory_security_invalid
  secure_regular_root "${CREDENTIALS_DIRECTORY}/client-cert.pem.cred" '600' || fail client_certificate_credential_security_invalid
  secure_regular_root "${CREDENTIALS_DIRECTORY}/client-key.pem.cred" '600' || fail client_key_credential_security_invalid
}

assert_source_files() {
  local source
  for source in "${SOURCE_FILES[@]}"; do
    [ -f "$script_directory/$source" ] && [ ! -L "$script_directory/$source" ] || fail source_file_missing_or_unsafe
  done
}

assert_same_or_absent() {
  local source="$1" target="$2" expected_mode="$3"
  if [ -e "$target" ] || [ -L "$target" ]; then
    secure_regular_root "$target" "$expected_mode" || fail existing_target_security_invalid
    cmp -s -- "$source" "$target" || fail existing_target_content_mismatch
  fi
}

assert_preexisting_mtls_credential_sources
assert_source_files

if [ -e "$INSTALL_DIRECTORY" ] || [ -L "$INSTALL_DIRECTORY" ]; then
  secure_directory "$INSTALL_DIRECTORY" '750' || fail install_directory_security_invalid
else
  [ -d /opt/lemtel-ha ] && [ ! -L /opt/lemtel-ha ] || fail install_parent_invalid
  install -d -o root -g root -m 0750 "$INSTALL_DIRECTORY"
fi
secure_directory "$UNIT_DIRECTORY" '755' || fail unit_directory_security_invalid

assert_same_or_absent "$script_directory/$RELAY_SOURCE" "$INSTALL_DIRECTORY/$RELAY_SOURCE" '750'
assert_same_or_absent "$script_directory/$CONTRACT_SOURCE" "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" '640'
assert_same_or_absent "$script_directory/$UNIT_SOURCE" "$UNIT_DIRECTORY/$UNIT_NAME" '644'

if [ ! -e "$INSTALL_DIRECTORY/$RELAY_SOURCE" ] && [ ! -L "$INSTALL_DIRECTORY/$RELAY_SOURCE" ]; then
  install -o root -g root -m 0750 "$script_directory/$RELAY_SOURCE" "$INSTALL_DIRECTORY/$RELAY_SOURCE"
fi
if [ ! -e "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" ] && [ ! -L "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" ]; then
  install -o root -g root -m 0640 "$script_directory/$CONTRACT_SOURCE" "$INSTALL_DIRECTORY/$CONTRACT_SOURCE"
fi
if [ ! -e "$UNIT_DIRECTORY/$UNIT_NAME" ] && [ ! -L "$UNIT_DIRECTORY/$UNIT_NAME" ]; then
  install -o root -g root -m 0644 "$script_directory/$UNIT_SOURCE" "$UNIT_DIRECTORY/$UNIT_NAME"
fi

secure_regular_root "$INSTALL_DIRECTORY/$RELAY_SOURCE" '750' || fail installed_relay_security_invalid
secure_regular_root "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" '640' || fail installed_contract_security_invalid
secure_regular_root "$UNIT_DIRECTORY/$UNIT_NAME" '644' || fail installed_unit_security_invalid
cmp -s -- "$script_directory/$RELAY_SOURCE" "$INSTALL_DIRECTORY/$RELAY_SOURCE" || fail installed_relay_content_mismatch
cmp -s -- "$script_directory/$CONTRACT_SOURCE" "$INSTALL_DIRECTORY/$CONTRACT_SOURCE" || fail installed_contract_content_mismatch
cmp -s -- "$script_directory/$UNIT_SOURCE" "$UNIT_DIRECTORY/$UNIT_NAME" || fail installed_unit_content_mismatch

printf 'do_signer_mtls_relay_source_only_deploy_format=lemtel_do_signer_mtls_relay_source_only_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'mtls_credential_sources_preexisting_root_only=true\n'
printf 'credential_values_read=false\n'
printf 'credential_values_emitted=false\n'
printf 'relay_configuration_created=false\n'
printf 'relay_source_installed=true\n'
printf 'systemd_unit_installed=true\n'
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
