#!/usr/bin/env bash
# Root-only local bootstrap for the Lemtel DO signer mTLS relay credentials.
# It deliberately creates no network, provider, Cloudflare, service, or runtime action.
set -euo pipefail
set +x

fail() {
  printf 'do_signer_mtls_relay_root_only_bootstrap_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly BOOTSTRAP_TOKEN='bootstrap_do_signer_mtls_relay_root_only'
readonly DIAGNOSTIC_TOKEN='diagnose_do_signer_mtls_relay_root_only'
readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'
readonly CREDENTIALS_DIRECTORY='/etc/lemtel-platform-signer/credentials'
readonly CLIENT_CERTIFICATE_SOURCE='/etc/lemtel-platform-signer/credentials/client-cert.pem.cred'
readonly CLIENT_KEY_SOURCE='/etc/lemtel-platform-signer/credentials/client-key.pem.cred'
readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-root-ca.pem'
readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'
readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/mtls-root-only-bootstrap.attestation'
readonly ROOT_CA_COMMON_NAME='Lemtel DO ephemeral mTLS root CA'
readonly CLIENT_COMMON_NAME='lemtel-do-signer-mtls-relay'
readonly CERTIFICATE_VALIDITY_DAYS='1'
readonly ATTESTATION_FORMAT='lemtel_do_signer_mtls_root_only_bootstrap_attestation_v2'

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

assert_empty_credentials_directory() {
  local -a entries=()
  shopt -s nullglob dotglob
  entries=("$CREDENTIALS_DIRECTORY"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 0 ] || fail credential_directory_not_empty
}

assert_leaf_credential_sources() {
  local -a entries=()
  secure_directory "$CREDENTIALS_DIRECTORY" '700' || fail credential_directory_security_invalid
  secure_regular_root "$CLIENT_CERTIFICATE_SOURCE" '600' || fail client_certificate_credential_security_invalid
  secure_regular_root "$CLIENT_KEY_SOURCE" '600' || fail client_key_credential_security_invalid
  shopt -s nullglob dotglob
  entries=("$CREDENTIALS_DIRECTORY"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 2 ] || fail credential_directory_contents_invalid
  for entry in "${entries[@]}"; do
    case "$entry" in
      "$CLIENT_CERTIFICATE_SOURCE"|"$CLIENT_KEY_SOURCE") ;;
      *) fail credential_directory_contents_invalid ;;
    esac
  done
}

certificate_fingerprint() {
  local certificate="$1" digest
  digest="$(openssl x509 -in "$certificate" -outform DER 2>/dev/null | sha256sum 2>/dev/null)" || fail certificate_fingerprint_failed
  digest="${digest%%[[:space:]]*}"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail certificate_fingerprint_invalid
  printf 'sha256:%s' "$digest"
}

TEMPORARY_DIRECTORY=''
ATTESTATION_TEMPORARY_FILE=''
ROOT_CA_CERTIFICATE_LINKED='false'
CERTIFICATE_SOURCE_LINKED='false'
KEY_SOURCE_LINKED='false'
ATTESTATION_LINKED='false'
BOOTSTRAP_COMPLETE='false'

remove_temporary_files() {
  [ -n "$ATTESTATION_TEMPORARY_FILE" ] && rm -f -- "$ATTESTATION_TEMPORARY_FILE" >/dev/null 2>&1 || true
  if [ -n "$TEMPORARY_DIRECTORY" ] && [ -d "$TEMPORARY_DIRECTORY" ] && [ ! -L "$TEMPORARY_DIRECTORY" ]; then
    rm -rf -- "$TEMPORARY_DIRECTORY" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [ "$BOOTSTRAP_COMPLETE" != 'true' ]; then
    [ "$ATTESTATION_LINKED" = 'true' ] && rm -f -- "$ATTESTATION_FILE" >/dev/null 2>&1 || true
    [ "$KEY_SOURCE_LINKED" = 'true' ] && rm -f -- "$CLIENT_KEY_SOURCE" >/dev/null 2>&1 || true
    [ "$CERTIFICATE_SOURCE_LINKED" = 'true' ] && rm -f -- "$CLIENT_CERTIFICATE_SOURCE" >/dev/null 2>&1 || true
    [ "$ROOT_CA_CERTIFICATE_LINKED" = 'true' ] && rm -f -- "$ROOT_CA_CERTIFICATE_FILE" >/dev/null 2>&1 || true
  fi
  remove_temporary_files
}

bootstrap() {
  local root_fingerprint leaf_fingerprint
  command -v openssl >/dev/null 2>&1 || fail openssl_required
  command -v systemd-creds >/dev/null 2>&1 || fail systemd_creds_required

  ensure_new_or_secure_directory '/etc' "$CREDENTIALS_PARENT" '755' '750' credentials_parent_security_invalid
  ensure_new_or_secure_directory "$CREDENTIALS_PARENT" "$CREDENTIALS_DIRECTORY" '750' '700' credential_directory_security_invalid
  ensure_new_or_secure_directory '/var/lib' "$ATTESTATION_PARENT" '755' '755' attestation_parent_security_invalid
  assert_empty_credentials_directory
  [ ! -e "$ROOT_CA_CERTIFICATE_FILE" ] && [ ! -L "$ROOT_CA_CERTIFICATE_FILE" ] || fail root_ca_certificate_target_exists
  [ ! -e "$ATTESTATION_FILE" ] && [ ! -L "$ATTESTATION_FILE" ] || fail attestation_target_exists

  TEMPORARY_DIRECTORY="$(mktemp -d "$CREDENTIALS_PARENT/.mtls-bootstrap.XXXXXX")" || fail temporary_directory_create_failed
  secure_directory "$TEMPORARY_DIRECTORY" '700' || fail temporary_directory_security_invalid
  ATTESTATION_TEMPORARY_FILE="$(mktemp "$ATTESTATION_PARENT/.mtls-bootstrap-attestation.XXXXXX")" || fail attestation_temporary_create_failed

  openssl ecparam -name prime256v1 -genkey -noout -out "$TEMPORARY_DIRECTORY/ca-key.pem" >/dev/null 2>&1 || fail root_ca_key_generation_failed
  openssl req -new -x509 -key "$TEMPORARY_DIRECTORY/ca-key.pem" -sha256 -days "$CERTIFICATE_VALIDITY_DAYS" -subj "/CN=$ROOT_CA_COMMON_NAME" -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' -addext 'keyUsage=critical,keyCertSign,cRLSign' -out "$TEMPORARY_DIRECTORY/ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_generation_failed
  openssl ecparam -name prime256v1 -genkey -noout -out "$TEMPORARY_DIRECTORY/leaf-key.pem" >/dev/null 2>&1 || fail leaf_key_generation_failed
  openssl req -new -key "$TEMPORARY_DIRECTORY/leaf-key.pem" -subj "/CN=$CLIENT_COMMON_NAME" -out "$TEMPORARY_DIRECTORY/leaf.csr" >/dev/null 2>&1 || fail leaf_csr_generation_failed
  printf '%s\n' '[leaf]' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature' 'extendedKeyUsage=clientAuth' 'subjectKeyIdentifier=hash' 'authorityKeyIdentifier=keyid,issuer' > "$TEMPORARY_DIRECTORY/leaf-extensions.cnf"
  openssl x509 -req -in "$TEMPORARY_DIRECTORY/leaf.csr" -CA "$TEMPORARY_DIRECTORY/ca-cert.pem" -CAkey "$TEMPORARY_DIRECTORY/ca-key.pem" -CAcreateserial -sha256 -days "$CERTIFICATE_VALIDITY_DAYS" -extfile "$TEMPORARY_DIRECTORY/leaf-extensions.cnf" -extensions leaf -out "$TEMPORARY_DIRECTORY/leaf-cert.pem" >/dev/null 2>&1 || fail leaf_certificate_generation_failed

  root_fingerprint="$(certificate_fingerprint "$TEMPORARY_DIRECTORY/ca-cert.pem")"
  leaf_fingerprint="$(certificate_fingerprint "$TEMPORARY_DIRECTORY/leaf-cert.pem")"
  rm -f -- "$TEMPORARY_DIRECTORY/ca-key.pem" "$TEMPORARY_DIRECTORY/ca-cert.srl" "$TEMPORARY_DIRECTORY/leaf.csr" "$TEMPORARY_DIRECTORY/leaf-extensions.cnf" >/dev/null 2>&1 || fail root_ca_cleanup_failed
  [ ! -e "$TEMPORARY_DIRECTORY/ca-key.pem" ] && [ ! -L "$TEMPORARY_DIRECTORY/ca-key.pem" ] || fail root_ca_cleanup_failed

  systemd-creds encrypt --name=client-cert.pem "$TEMPORARY_DIRECTORY/leaf-cert.pem" "$TEMPORARY_DIRECTORY/client-cert.pem.cred" >/dev/null 2>&1 || fail client_certificate_encryption_failed
  systemd-creds encrypt --name=client-key.pem "$TEMPORARY_DIRECTORY/leaf-key.pem" "$TEMPORARY_DIRECTORY/client-key.pem.cred" >/dev/null 2>&1 || fail client_key_encryption_failed
  chmod 0600 -- "$TEMPORARY_DIRECTORY/client-cert.pem.cred" "$TEMPORARY_DIRECTORY/client-key.pem.cred" >/dev/null 2>&1 || fail credential_mode_set_failed
  chown root:root -- "$TEMPORARY_DIRECTORY/client-cert.pem.cred" "$TEMPORARY_DIRECTORY/client-key.pem.cred" >/dev/null 2>&1 || fail credential_owner_set_failed
  secure_regular_root "$TEMPORARY_DIRECTORY/client-cert.pem.cred" '600' || fail client_certificate_credential_security_invalid
  secure_regular_root "$TEMPORARY_DIRECTORY/client-key.pem.cred" '600' || fail client_key_credential_security_invalid
  chmod 0644 -- "$TEMPORARY_DIRECTORY/ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_mode_set_failed
  chown root:root -- "$TEMPORARY_DIRECTORY/ca-cert.pem" >/dev/null 2>&1 || fail root_ca_certificate_owner_set_failed
  secure_regular_root "$TEMPORARY_DIRECTORY/ca-cert.pem" '644' || fail root_ca_certificate_security_invalid

  printf '%s\n' \
    "format=$ATTESTATION_FORMAT" \
    "root_ca_certificate_sha256=$root_fingerprint" \
    "root_ca_certificate_file=$ROOT_CA_CERTIFICATE_FILE" \
    'root_ca_certificate_persisted=true' \
    'root_ca_certificate_mode=0644' \
    'root_ca_certificate_root_owned=true' \
    'root_ca_private_key_included=false' \
    'root_ca_private_key_persisted=false' \
    "leaf_certificate_sha256=$leaf_fingerprint" \
    "leaf_common_name=$CLIENT_COMMON_NAME" \
    'leaf_private_key_included=false' \
    'credential_directory_root_only=true' \
    'client_certificate_source_root_only=true' \
    'client_key_source_root_only=true' > "$ATTESTATION_TEMPORARY_FILE"
  chmod 0644 -- "$ATTESTATION_TEMPORARY_FILE" >/dev/null 2>&1 || fail attestation_mode_set_failed
  chown root:root -- "$ATTESTATION_TEMPORARY_FILE" >/dev/null 2>&1 || fail attestation_owner_set_failed
  secure_regular_root "$ATTESTATION_TEMPORARY_FILE" '644' || fail attestation_security_invalid

  ln -- "$TEMPORARY_DIRECTORY/ca-cert.pem" "$ROOT_CA_CERTIFICATE_FILE" >/dev/null 2>&1 || fail root_ca_certificate_write_failed
  ROOT_CA_CERTIFICATE_LINKED='true'
  ln -- "$TEMPORARY_DIRECTORY/client-cert.pem.cred" "$CLIENT_CERTIFICATE_SOURCE" >/dev/null 2>&1 || fail client_certificate_source_write_failed
  CERTIFICATE_SOURCE_LINKED='true'
  ln -- "$TEMPORARY_DIRECTORY/client-key.pem.cred" "$CLIENT_KEY_SOURCE" >/dev/null 2>&1 || fail client_key_source_write_failed
  KEY_SOURCE_LINKED='true'
  ln -- "$ATTESTATION_TEMPORARY_FILE" "$ATTESTATION_FILE" >/dev/null 2>&1 || fail attestation_write_failed
  ATTESTATION_LINKED='true'

  remove_temporary_files
  [ ! -e "$TEMPORARY_DIRECTORY" ] && [ ! -L "$TEMPORARY_DIRECTORY" ] || fail temporary_cleanup_failed
  [ ! -e "$ATTESTATION_TEMPORARY_FILE" ] && [ ! -L "$ATTESTATION_TEMPORARY_FILE" ] || fail temporary_cleanup_failed
  TEMPORARY_DIRECTORY=''
  ATTESTATION_TEMPORARY_FILE=''
  assert_leaf_credential_sources
  secure_regular_root "$ROOT_CA_CERTIFICATE_FILE" '644' || fail root_ca_certificate_security_invalid
  secure_regular_root "$ATTESTATION_FILE" '644' || fail attestation_security_invalid
  BOOTSTRAP_COMPLETE='true'

  printf 'do_signer_mtls_relay_root_only_bootstrap_format=lemtel_do_signer_mtls_root_only_bootstrap_v1\n'
  printf 'credential_sources_written=true\n'
  printf 'root_ca_public_certificate_written=true\n'
  printf 'root_ca_public_certificate_root_owned_0644=true\n'
  printf 'public_attestation_written=true\n'
  printf 'root_ca_private_key_destroyed=true\n'
  printf 'root_ca_private_key_persisted=false\n'
  printf 'temporary_files_destroyed=true\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'cloudflare_contacted=false\n'
  printf 'ca_uploaded=false\n'
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
  printf 'do_signer_mtls_relay_root_only_bootstrap_status=complete\n'
}

read_public_attestation() {
  local -a lines=()
  local root_fingerprint leaf_fingerprint
  secure_regular_root "$ATTESTATION_FILE" '644' || return 1
  mapfile -t lines < "$ATTESTATION_FILE" || return 1
  [ "${#lines[@]}" -eq 14 ] || return 1
  [ "${lines[0]}" = "format=$ATTESTATION_FORMAT" ] || return 1
  root_fingerprint="${lines[1]#root_ca_certificate_sha256=}"
  leaf_fingerprint="${lines[8]#leaf_certificate_sha256=}"
  [ "${lines[1]}" = "root_ca_certificate_sha256=$root_fingerprint" ] || return 1
  [ "${lines[2]}" = "root_ca_certificate_file=$ROOT_CA_CERTIFICATE_FILE" ] || return 1
  [ "${lines[3]}" = 'root_ca_certificate_persisted=true' ] || return 1
  [ "${lines[4]}" = 'root_ca_certificate_mode=0644' ] || return 1
  [ "${lines[5]}" = 'root_ca_certificate_root_owned=true' ] || return 1
  [ "${lines[6]}" = 'root_ca_private_key_included=false' ] || return 1
  [ "${lines[7]}" = 'root_ca_private_key_persisted=false' ] || return 1
  [ "${lines[8]}" = "leaf_certificate_sha256=$leaf_fingerprint" ] || return 1
  [ "${lines[9]}" = "leaf_common_name=$CLIENT_COMMON_NAME" ] || return 1
  [ "${lines[10]}" = 'leaf_private_key_included=false' ] || return 1
  [ "${lines[11]}" = 'credential_directory_root_only=true' ] || return 1
  [ "${lines[12]}" = 'client_certificate_source_root_only=true' ] || return 1
  [ "${lines[13]}" = 'client_key_source_root_only=true' ] || return 1
  [[ "$root_fingerprint" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  [[ "$leaf_fingerprint" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '%s\n%s\n' "$root_fingerprint" "$leaf_fingerprint"
}

diagnose() {
  local credential_directory_state='false' client_certificate_state='false' client_key_state='false' root_ca_certificate_state='false' attestation_state='false'
  local -a fingerprints=()
  secure_directory "$CREDENTIALS_DIRECTORY" '700' && credential_directory_state='true'
  secure_regular_root "$CLIENT_CERTIFICATE_SOURCE" '600' && client_certificate_state='true'
  secure_regular_root "$CLIENT_KEY_SOURCE" '600' && client_key_state='true'
  secure_regular_root "$ROOT_CA_CERTIFICATE_FILE" '644' && root_ca_certificate_state='true'
  mapfile -t fingerprints < <(read_public_attestation) || true
  if [ "${#fingerprints[@]}" -eq 2 ]; then
    attestation_state='true'
  fi

  printf 'do_signer_mtls_relay_root_only_diagnostic_format=lemtel_do_signer_mtls_root_only_diagnostic_v1\n'
  printf 'credential_directory_root_only=%s\n' "$credential_directory_state"
  printf 'client_certificate_source_root_only=%s\n' "$client_certificate_state"
  printf 'client_key_source_root_only=%s\n' "$client_key_state"
  printf 'root_ca_public_certificate_root_owned_0644=%s\n' "$root_ca_certificate_state"
  printf 'public_attestation_valid=%s\n' "$attestation_state"
  if [ "$attestation_state" = 'true' ]; then
    printf 'root_ca_certificate_fingerprint=%s\n' "${fingerprints[0]}"
    printf 'leaf_certificate_fingerprint=%s\n' "${fingerprints[1]}"
  fi
  printf 'credential_contents_read=false\n'
  printf 'root_ca_certificate_pem_read=false\n'
  printf 'root_ca_certificate_pem_returned=false\n'
  printf 'private_key_content_returned=false\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'service_state_read=false\n'
  printf 'do_signer_mtls_relay_root_only_diagnostic_status=%s\n' "$([ "$attestation_state" = 'true' ] && printf complete || printf incomplete)"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

case "${LEMTEL_HA_EXECUTE:-}" in
  "$BOOTSTRAP_TOKEN") bootstrap ;;
  "$DIAGNOSTIC_TOKEN") diagnose ;;
  *) fail execution_token_required ;;
esac
