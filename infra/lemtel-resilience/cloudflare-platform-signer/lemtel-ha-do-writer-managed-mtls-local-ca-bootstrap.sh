#!/bin/bash -p
# Root-only bootstrap for the Lemtel durable local mTLS issuer fallback.
# It creates a new encrypted CA key and its public certificate only. It never
# imports the certificate, issues a leaf, configures Access, or starts a service.
set -euo pipefail
set +x
umask 077
IFS=$'\n\t'
readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$TRUSTED_PATH"
unset BASH_ENV CDPATH ENV GLOBIGNORE OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES RANDFILE

fail() {
  printf 'do_managed_mtls_local_ca_bootstrap_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly BOOTSTRAP_TOKEN='bootstrap_do_managed_mtls_local_ca_root_only'
readonly DIAGNOSTIC_TOKEN='diagnose_do_managed_mtls_local_ca_root_only'
readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'
readonly ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'
readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'
readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'
readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'
readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'
readonly PRIVATE_KEY_TMPFS_PARENT='/run'
readonly VERIFICATION_TMPFS_PARENT='/run'
readonly ROOT_CA_COMMON_NAME='Lemtel signer mTLS managed root CA'
readonly ROOT_CA_VALIDITY_DAYS='365'
readonly ATTESTATION_FORMAT='lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1'

[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required

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

ensure_new_or_secure_directory() {
  local parent="$1" path="$2" parent_mode="$3" mode="$4" invalid_reason="$5"
  secure_directory "$parent" "$parent_mode" || fail "$invalid_reason"
  if [ -e "$path" ] || [ -L "$path" ]; then
    secure_directory "$path" "$mode" || fail "$invalid_reason"
  else
    mkdir -m "$mode" -- "$path" >/dev/null 2>&1 || fail "$invalid_reason"
    chown root:root -- "$path" >/dev/null 2>&1 || fail "$invalid_reason"
    secure_directory "$path" "$mode" || fail "$invalid_reason"
  fi
}

assert_empty_issuer_directory() {
  local -a entries=()
  secure_directory "$ISSUER_DIRECTORY" '700' || fail issuer_directory_security_invalid
  shopt -s nullglob dotglob
  entries=("$ISSUER_DIRECTORY"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 0 ] || fail issuer_directory_not_empty
}

final_outputs_secure() {
  local -a entries=()
  secure_directory "$CREDENTIALS_PARENT" '750' || return 1
  secure_directory "$ISSUER_DIRECTORY" '700' || return 1
  secure_regular_root "$ROOT_CA_KEY_CREDENTIAL" '600' || return 1
  secure_regular_root "$ROOT_CA_CERTIFICATE_FILE" '644' || return 1
  secure_regular_root "$ATTESTATION_FILE" '644' || return 1
  shopt -s nullglob dotglob
  entries=("$ISSUER_DIRECTORY"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 1 ] && [ "${entries[0]}" = "$ROOT_CA_KEY_CREDENTIAL" ]
}

assert_final_outputs() {
  final_outputs_secure || fail final_outputs_security_invalid
}

certificate_fingerprint() {
  local certificate="$1" digest
  digest="$(openssl x509 -in "$certificate" -outform DER 2>/dev/null | sha256sum 2>/dev/null)" || fail certificate_fingerprint_failed
  digest="${digest%%[[:space:]]*}"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail certificate_fingerprint_invalid
  printf 'sha256:%s' "$digest"
}

secure_tmpfs_parent() {
  local path="$1" filesystem_type=''
  filesystem_type="$(findmnt -n -o FSTYPE --target "$path" 2>/dev/null)" || return 1
  [ "$filesystem_type" = 'tmpfs' ] || return 1
  secure_directory "$path" '755'
}

read_public_attestation() {
  local -a lines=()
  local root_fingerprint
  secure_regular_root "$ATTESTATION_FILE" '644' || return 1
  mapfile -t lines < "$ATTESTATION_FILE" || return 1
  [ "${#lines[@]}" -eq 14 ] || return 1
  root_fingerprint="${lines[2]#root_ca_certificate_sha256=}"
  [ "${lines[0]}" = "format=$ATTESTATION_FORMAT" ] || return 1
  [ "${lines[1]}" = 'issuer_type=local_root_only_encrypted_systemd_credential_host_bound' ] || return 1
  [ "${lines[2]}" = "root_ca_certificate_sha256=$root_fingerprint" ] || return 1
  [ "${lines[3]}" = "root_ca_certificate_file=$ROOT_CA_CERTIFICATE_FILE" ] || return 1
  [ "${lines[4]}" = 'root_ca_certificate_persisted=true' ] || return 1
  [ "${lines[5]}" = 'root_ca_certificate_mode=0644' ] || return 1
  [ "${lines[6]}" = 'root_ca_certificate_root_owned=true' ] || return 1
  [ "${lines[7]}" = "root_ca_key_credential_file=$ROOT_CA_KEY_CREDENTIAL" ] || return 1
  [ "${lines[8]}" = 'root_ca_key_credential_root_only=true' ] || return 1
  [ "${lines[9]}" = 'root_ca_private_key_cleartext_persisted=false' ] || return 1
  [ "${lines[10]}" = 'cloudflare_access_imported=false' ] || return 1
  [ "${lines[11]}" = 'leaf_certificate_issued=false' ] || return 1
  [ "${lines[12]}" = 'service_auth_policy_configured=false' ] || return 1
  [ "${lines[13]}" = 'local_relay_activated=false' ] || return 1
  [[ "$root_fingerprint" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '%s\n' "$root_fingerprint"
}

credential_matches_certificate() {
  secure_tmpfs_parent "$VERIFICATION_TMPFS_PARENT" || return 1
  VERIFICATION_TEMPORARY_DIRECTORY="$(mktemp -d "$VERIFICATION_TMPFS_PARENT/lemtel-managed-mtls-verify.XXXXXX")" || return 1
  secure_directory "$VERIFICATION_TEMPORARY_DIRECTORY" '700' || return 1
  VERIFICATION_PRIVATE_KEY_FILE="$VERIFICATION_TEMPORARY_DIRECTORY/root-ca-key.pem"
  systemd-creds decrypt "$ROOT_CA_KEY_CREDENTIAL" "$VERIFICATION_PRIVATE_KEY_FILE" >/dev/null 2>&1 || { remove_verification_material; return 1; }
  chmod 0600 -- "$VERIFICATION_PRIVATE_KEY_FILE" >/dev/null 2>&1 || { remove_verification_material; return 1; }
  chown root:root -- "$VERIFICATION_PRIVATE_KEY_FILE" >/dev/null 2>&1 || { remove_verification_material; return 1; }
  secure_regular_root "$VERIFICATION_PRIVATE_KEY_FILE" '600' || { remove_verification_material; return 1; }
  openssl x509 -in "$ROOT_CA_CERTIFICATE_FILE" -check_privatekey -noout -key "$VERIFICATION_PRIVATE_KEY_FILE" >/dev/null 2>&1 || { remove_verification_material; return 1; }
  remove_verification_material || return 1
  [ "$ROLLBACK_INCOMPLETE" = 'false' ]
}

existing_complete() {
  local -a fingerprints=()
  local actual_fingerprint
  final_outputs_secure || return 1
  mapfile -t fingerprints < <(read_public_attestation) || return 1
  [ "${#fingerprints[@]}" -eq 1 ] || return 1
  actual_fingerprint="$(certificate_fingerprint "$ROOT_CA_CERTIFICATE_FILE")"
  [ "$actual_fingerprint" = "${fingerprints[0]}" ] || return 1
  credential_matches_certificate
}

TEMPORARY_DIRECTORY=''
PERSISTENT_STAGE_DIRECTORY=''
ATTESTATION_TEMPORARY_FILE=''
VERIFICATION_TEMPORARY_DIRECTORY=''
VERIFICATION_PRIVATE_KEY_FILE=''
ROOT_CA_KEY_LINKED='false'
ROOT_CA_CERTIFICATE_LINKED='false'
ATTESTATION_LINKED='false'
CREDENTIALS_PARENT_CREATED='false'
ISSUER_DIRECTORY_CREATED='false'
ATTESTATION_PARENT_CREATED='false'
BOOTSTRAP_COMPLETE='false'
ROLLBACK_INCOMPLETE='false'

note_rollback_incomplete() {
  ROLLBACK_INCOMPLETE='true'
  printf 'rollback_cleanup_incomplete=true\n' >&2
  printf 'rollback_step=%s\n' "$1" >&2
}

remove_file_if_present() {
  local path="$1" label="$2"
  if [ -e "$path" ] || [ -L "$path" ]; then
    rm -f -- "$path" >/dev/null 2>&1 || { note_rollback_incomplete "$label"; return 1; }
    [ ! -e "$path" ] && [ ! -L "$path" ] || { note_rollback_incomplete "$label"; return 1; }
  fi
}

remove_directory_if_empty() {
  local path="$1" label="$2"
  [ -d "$path" ] && [ ! -L "$path" ] || return 0
  rm -d -- "$path" >/dev/null 2>&1 || { note_rollback_incomplete "$label"; return 1; }
  [ ! -e "$path" ] && [ ! -L "$path" ] || { note_rollback_incomplete "$label"; return 1; }
}

remove_temporary_files() {
  [ -n "$ATTESTATION_TEMPORARY_FILE" ] && remove_file_if_present "$ATTESTATION_TEMPORARY_FILE" attestation_temporary || true
  if [ -n "$TEMPORARY_DIRECTORY" ] && [ -d "$TEMPORARY_DIRECTORY" ] && [ ! -L "$TEMPORARY_DIRECTORY" ]; then
    rm -rf -- "$TEMPORARY_DIRECTORY" >/dev/null 2>&1 || note_rollback_incomplete private_key_tmpfs_directory
    [ ! -e "$TEMPORARY_DIRECTORY" ] && [ ! -L "$TEMPORARY_DIRECTORY" ] || note_rollback_incomplete private_key_tmpfs_directory
  fi
  if [ -n "$PERSISTENT_STAGE_DIRECTORY" ] && [ -d "$PERSISTENT_STAGE_DIRECTORY" ] && [ ! -L "$PERSISTENT_STAGE_DIRECTORY" ]; then
    rm -rf -- "$PERSISTENT_STAGE_DIRECTORY" >/dev/null 2>&1 || note_rollback_incomplete persistent_stage_directory
    [ ! -e "$PERSISTENT_STAGE_DIRECTORY" ] && [ ! -L "$PERSISTENT_STAGE_DIRECTORY" ] || note_rollback_incomplete persistent_stage_directory
  fi
}

remove_verification_material() {
  [ -n "$VERIFICATION_PRIVATE_KEY_FILE" ] && remove_file_if_present "$VERIFICATION_PRIVATE_KEY_FILE" verification_private_key || true
  if [ -n "$VERIFICATION_TEMPORARY_DIRECTORY" ] && [ -d "$VERIFICATION_TEMPORARY_DIRECTORY" ] && [ ! -L "$VERIFICATION_TEMPORARY_DIRECTORY" ]; then
    remove_directory_if_empty "$VERIFICATION_TEMPORARY_DIRECTORY" verification_temporary_directory || true
  fi
  if [ "$ROLLBACK_INCOMPLETE" = 'false' ]; then
    VERIFICATION_PRIVATE_KEY_FILE=''
    VERIFICATION_TEMPORARY_DIRECTORY=''
    return 0
  fi
  return 1
}

cleanup() {
  if [ "$BOOTSTRAP_COMPLETE" != 'true' ]; then
    [ "$ATTESTATION_LINKED" = 'true' ] && remove_file_if_present "$ATTESTATION_FILE" attestation_output || true
    [ "$ROOT_CA_CERTIFICATE_LINKED" = 'true' ] && remove_file_if_present "$ROOT_CA_CERTIFICATE_FILE" root_ca_certificate_output || true
    [ "$ROOT_CA_KEY_LINKED" = 'true' ] && remove_file_if_present "$ROOT_CA_KEY_CREDENTIAL" root_ca_key_credential_output || true
  fi
  remove_temporary_files
  remove_verification_material || true
  if [ "$BOOTSTRAP_COMPLETE" != 'true' ] && [ "$ISSUER_DIRECTORY_CREATED" = 'true' ]; then
    remove_directory_if_empty "$ISSUER_DIRECTORY" issuer_directory || true
  fi
  if [ "$BOOTSTRAP_COMPLETE" != 'true' ] && [ "$ATTESTATION_PARENT_CREATED" = 'true' ]; then
    remove_directory_if_empty "$ATTESTATION_PARENT" attestation_parent || true
  fi
  if [ "$BOOTSTRAP_COMPLETE" != 'true' ] && [ "$CREDENTIALS_PARENT_CREATED" = 'true' ]; then
    remove_directory_if_empty "$CREDENTIALS_PARENT" credentials_parent || true
  fi
}

report_bootstrap_state() {
  local action="$1"
  printf 'do_managed_mtls_local_ca_bootstrap_format=lemtel_do_managed_mtls_local_ca_bootstrap_v1\n'
  printf 'writer=digitalocean_writer\n'
  printf 'bootstrap_action=%s\n' "$action"
  printf 'root_ca_key_credential_encrypted_root_only=true\n'
  printf 'root_ca_key_credential_host_bound=true\n'
  printf 'root_ca_private_key_cleartext_persisted=false\n'
  printf 'root_ca_public_certificate_available=true\n'
  printf 'public_attestation_valid=true\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'cloudflare_contacted=false\n'
  printf 'cloudflare_access_imported=false\n'
  printf 'leaf_certificate_issued=false\n'
  printf 'service_auth_policy_configured=false\n'
  printf 'systemd_daemon_reloaded=false\n'
  printf 'service_enabled=false\n'
  printf 'service_started=false\n'
  printf 'timer_enabled=false\n'
  printf 'routes_changed=false\n'
  printf 'runtime_started=false\n'
  printf 'promotion_executed=false\n'
  printf 'fencing_executed=false\n'
  printf 'failover_executed=false\n'
  printf 'telephony_contacted=false\n'
  printf 'do_managed_mtls_local_ca_bootstrap_status=complete\n'
}

bootstrap() {
  local root_fingerprint
  command -v openssl >/dev/null 2>&1 || fail openssl_required
  command -v systemd-creds >/dev/null 2>&1 || fail systemd_creds_required

  if [ -e "$ISSUER_DIRECTORY" ] || [ -L "$ISSUER_DIRECTORY" ] || [ -e "$ROOT_CA_CERTIFICATE_FILE" ] || [ -L "$ROOT_CA_CERTIFICATE_FILE" ] || [ -e "$ATTESTATION_FILE" ] || [ -L "$ATTESTATION_FILE" ]; then
    existing_complete || fail existing_state_incomplete_or_corrupt
    BOOTSTRAP_COMPLETE='true'
    report_bootstrap_state already_complete
    return
  fi

  [ -e "$CREDENTIALS_PARENT" ] || [ -L "$CREDENTIALS_PARENT" ] || CREDENTIALS_PARENT_CREATED='true'
  ensure_new_or_secure_directory '/etc' "$CREDENTIALS_PARENT" '755' '750' credentials_parent_security_invalid
  [ -e "$ISSUER_DIRECTORY" ] || [ -L "$ISSUER_DIRECTORY" ] || ISSUER_DIRECTORY_CREATED='true'
  ensure_new_or_secure_directory "$CREDENTIALS_PARENT" "$ISSUER_DIRECTORY" '750' '700' issuer_directory_security_invalid
  [ -e "$ATTESTATION_PARENT" ] || [ -L "$ATTESTATION_PARENT" ] || ATTESTATION_PARENT_CREATED='true'
  ensure_new_or_secure_directory '/var/lib' "$ATTESTATION_PARENT" '755' '755' attestation_parent_security_invalid
  assert_empty_issuer_directory
  secure_tmpfs_parent "$PRIVATE_KEY_TMPFS_PARENT" || fail private_key_tmpfs_required

  TEMPORARY_DIRECTORY="$(mktemp -d "$PRIVATE_KEY_TMPFS_PARENT/lemtel-managed-mtls-ca-bootstrap.XXXXXX")" || fail temporary_directory_create_failed
  secure_directory "$TEMPORARY_DIRECTORY" '700' || fail temporary_directory_security_invalid
  PERSISTENT_STAGE_DIRECTORY="$(mktemp -d "$CREDENTIALS_PARENT/.managed-mtls-ca-stage.XXXXXX")" || fail persistent_stage_directory_create_failed
  secure_directory "$PERSISTENT_STAGE_DIRECTORY" '700' || fail persistent_stage_directory_security_invalid
  ATTESTATION_TEMPORARY_FILE="$(mktemp "$ATTESTATION_PARENT/.managed-mtls-ca-attestation.XXXXXX")" || fail attestation_temporary_create_failed

  openssl ecparam -name prime256v1 -genkey -noout -out "$TEMPORARY_DIRECTORY/root-ca-key.pem" >/dev/null 2>&1 || fail root_ca_key_generation_failed
  openssl req -new -x509 -key "$TEMPORARY_DIRECTORY/root-ca-key.pem" -sha256 -days "$ROOT_CA_VALIDITY_DAYS" -subj "/CN=$ROOT_CA_COMMON_NAME" -addext 'basicConstraints=critical,CA:TRUE,pathlen:1' -addext 'keyUsage=critical,keyCertSign,cRLSign' -addext 'subjectKeyIdentifier=hash' -out "$TEMPORARY_DIRECTORY/root-ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_generation_failed
  root_fingerprint="$(certificate_fingerprint "$TEMPORARY_DIRECTORY/root-ca-cert.pem")"

  systemd-creds encrypt --with-key=host --name=root-ca-key.pem.cred "$TEMPORARY_DIRECTORY/root-ca-key.pem" "$PERSISTENT_STAGE_DIRECTORY/root-ca-key.pem.cred" >/dev/null 2>&1 || fail root_ca_key_encryption_failed
  chmod 0600 -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-key.pem.cred" >/dev/null 2>&1 || fail root_ca_key_credential_mode_set_failed
  chown root:root -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-key.pem.cred" >/dev/null 2>&1 || fail root_ca_key_credential_owner_set_failed
  secure_regular_root "$PERSISTENT_STAGE_DIRECTORY/root-ca-key.pem.cred" '600' || fail root_ca_key_credential_security_invalid
  rm -f -- "$TEMPORARY_DIRECTORY/root-ca-key.pem" >/dev/null 2>&1 || fail root_ca_private_key_cleanup_failed
  [ ! -e "$TEMPORARY_DIRECTORY/root-ca-key.pem" ] && [ ! -L "$TEMPORARY_DIRECTORY/root-ca-key.pem" ] || fail root_ca_private_key_cleanup_failed

  cp -- "$TEMPORARY_DIRECTORY/root-ca-cert.pem" "$PERSISTENT_STAGE_DIRECTORY/root-ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_stage_failed
  chmod 0644 -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_mode_set_failed
  chown root:root -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_owner_set_failed
  secure_regular_root "$PERSISTENT_STAGE_DIRECTORY/root-ca-cert.pem" '644' || fail root_ca_certificate_security_invalid

  printf '%s\n' \
    "format=$ATTESTATION_FORMAT" \
    'issuer_type=local_root_only_encrypted_systemd_credential_host_bound' \
    "root_ca_certificate_sha256=$root_fingerprint" \
    "root_ca_certificate_file=$ROOT_CA_CERTIFICATE_FILE" \
    'root_ca_certificate_persisted=true' \
    'root_ca_certificate_mode=0644' \
    'root_ca_certificate_root_owned=true' \
    "root_ca_key_credential_file=$ROOT_CA_KEY_CREDENTIAL" \
    'root_ca_key_credential_root_only=true' \
    'root_ca_private_key_cleartext_persisted=false' \
    'cloudflare_access_imported=false' \
    'leaf_certificate_issued=false' \
    'service_auth_policy_configured=false' \
    'local_relay_activated=false' > "$ATTESTATION_TEMPORARY_FILE"
  chmod 0644 -- "$ATTESTATION_TEMPORARY_FILE" >/dev/null 2>&1 || fail attestation_mode_set_failed
  chown root:root -- "$ATTESTATION_TEMPORARY_FILE" >/dev/null 2>&1 || fail attestation_owner_set_failed
  secure_regular_root "$ATTESTATION_TEMPORARY_FILE" '644' || fail attestation_security_invalid

  ln -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-key.pem.cred" "$ROOT_CA_KEY_CREDENTIAL" >/dev/null 2>&1 || fail root_ca_key_credential_write_failed
  ROOT_CA_KEY_LINKED='true'
  ln -- "$PERSISTENT_STAGE_DIRECTORY/root-ca-cert.pem" "$ROOT_CA_CERTIFICATE_FILE" >/dev/null 2>&1 || fail root_ca_certificate_write_failed
  ROOT_CA_CERTIFICATE_LINKED='true'
  ln -- "$ATTESTATION_TEMPORARY_FILE" "$ATTESTATION_FILE" >/dev/null 2>&1 || fail attestation_write_failed
  ATTESTATION_LINKED='true'

  remove_temporary_files
  [ "$ROLLBACK_INCOMPLETE" = 'false' ] || fail temporary_cleanup_failed
  [ ! -e "$TEMPORARY_DIRECTORY" ] && [ ! -L "$TEMPORARY_DIRECTORY" ] || fail temporary_cleanup_failed
  [ ! -e "$PERSISTENT_STAGE_DIRECTORY" ] && [ ! -L "$PERSISTENT_STAGE_DIRECTORY" ] || fail temporary_cleanup_failed
  [ ! -e "$ATTESTATION_TEMPORARY_FILE" ] && [ ! -L "$ATTESTATION_TEMPORARY_FILE" ] || fail temporary_cleanup_failed
  TEMPORARY_DIRECTORY=''
  PERSISTENT_STAGE_DIRECTORY=''
  ATTESTATION_TEMPORARY_FILE=''
  assert_final_outputs
  existing_complete || fail final_attestation_reconciliation_invalid
  BOOTSTRAP_COMPLETE='true'
  report_bootstrap_state created
}

diagnose() {
  local issuer_directory_state='false' root_ca_key_credential_state='false' root_ca_certificate_state='false' attestation_state='false'
  local -a fingerprints=()
  secure_directory "$ISSUER_DIRECTORY" '700' && issuer_directory_state='true'
  secure_regular_root "$ROOT_CA_KEY_CREDENTIAL" '600' && root_ca_key_credential_state='true'
  secure_regular_root "$ROOT_CA_CERTIFICATE_FILE" '644' && root_ca_certificate_state='true'
  mapfile -t fingerprints < <(read_public_attestation) || true
  if [ "${#fingerprints[@]}" -eq 1 ]; then
    attestation_state='true'
  fi

  printf 'do_managed_mtls_local_ca_diagnostic_format=lemtel_do_managed_mtls_local_ca_diagnostic_v1\n'
  printf 'issuer_directory_root_only=%s\n' "$issuer_directory_state"
  printf 'root_ca_key_credential_root_only=%s\n' "$root_ca_key_credential_state"
  printf 'root_ca_public_certificate_root_owned_0644=%s\n' "$root_ca_certificate_state"
  printf 'public_attestation_valid=%s\n' "$attestation_state"
  printf 'root_ca_certificate_pem_read=false\n'
  printf 'root_ca_certificate_pem_returned=false\n'
  printf 'root_ca_key_credential_contents_read=false\n'
  printf 'private_key_content_returned=false\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'cloudflare_contacted=false\n'
  printf 'service_state_read=false\n'
  printf 'do_managed_mtls_local_ca_diagnostic_status=%s\n' "$([ "$attestation_state" = 'true' ] && printf complete || printf incomplete)"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

case "${LEMTEL_HA_EXECUTE:-}" in
  "$BOOTSTRAP_TOKEN") bootstrap ;;
  "$DIAGNOSTIC_TOKEN") diagnose ;;
  *) fail execution_token_required ;;
esac
