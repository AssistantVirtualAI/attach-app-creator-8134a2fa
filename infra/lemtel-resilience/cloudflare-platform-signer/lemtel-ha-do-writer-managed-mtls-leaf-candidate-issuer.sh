#!/bin/bash -p
# Source-only preparation for a future, manually reviewed mTLS leaf candidate.
# The compiled authorization remains false: this source cannot issue a candidate
# until independent at-rest and lifecycle gates have been evidenced and reviewed.
set -euo pipefail
set +x
umask 077
IFS=$'\n\t'
readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$TRUSTED_PATH"
unset BASH_ENV CDPATH ENV GLOBIGNORE OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES RANDFILE

fail() {
  printf 'do_managed_mtls_leaf_candidate_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly EXECUTION_TOKEN='prepare_do_managed_mtls_leaf_candidate'
readonly CANDIDATE_ISSUANCE_AUTHORIZED='false'
readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'
readonly ROOT_ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'
readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'
readonly ROOT_CA_CERTIFICATE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'
readonly ROOT_CA_ATTESTATION='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'
readonly CANDIDATES_DIRECTORY='/etc/lemtel-platform-signer/managed-mtls-leaf-candidates'
readonly STATE_PARENT='/var/lib/lemtel-platform-signer'
readonly LOCK_FILE='/var/lib/lemtel-platform-signer/managed-mtls-leaf-candidate.lock'
readonly PRIVATE_TMPFS_PARENT='/run'
readonly CLIENT_COMMON_NAME='lemtel-do-signer-mtls-relay'
readonly LEAF_VALIDITY_DAYS='1'
readonly ATTESTATION_FORMAT='lemtel_do_managed_mtls_leaf_candidate_attestation_v1'

[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required
[ "${LEMTEL_HA_EXECUTE:-}" = "$EXECUTION_TOKEN" ] || fail execution_token_required
[[ "${LEMTEL_MTLS_CANDIDATE_GENERATION:-}" =~ ^[1-9][0-9]{0,5}$ ]] || fail candidate_generation_required
readonly GENERATION="$LEMTEL_MTLS_CANDIDATE_GENERATION"
[ "$CANDIDATE_ISSUANCE_AUTHORIZED" = 'true' ] || fail external_at_rest_and_lifecycle_gates_required

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

secure_tmpfs_parent() {
  local path="$1" filesystem_type=''
  filesystem_type="$(findmnt -n -o FSTYPE --target "$path" 2>/dev/null)" || return 1
  [ "$filesystem_type" = 'tmpfs' ] && secure_directory "$path" '755'
}

certificate_fingerprint() {
  local certificate="$1" digest
  digest="$(openssl x509 -in "$certificate" -outform DER 2>/dev/null | sha256sum 2>/dev/null)" || fail certificate_fingerprint_failed
  digest="${digest%%[[:space:]]*}"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail certificate_fingerprint_invalid
  printf 'sha256:%s' "$digest"
}

public_key_digest_from_certificate() {
  local certificate="$1" digest
  digest="$(openssl x509 -in "$certificate" -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum 2>/dev/null)" || fail root_ca_public_key_read_failed
  digest="${digest%%[[:space:]]*}"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail root_ca_public_key_digest_invalid
  printf '%s' "$digest"
}

public_key_digest_from_private_key() {
  local key="$1" digest
  digest="$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum 2>/dev/null)" || fail root_ca_private_key_read_failed
  digest="${digest%%[[:space:]]*}"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || fail root_ca_private_key_digest_invalid
  printf '%s' "$digest"
}

read_root_attestation() {
  local -a lines=()
  local root_fingerprint
  secure_regular_root "$ROOT_CA_ATTESTATION" '644' || return 1
  mapfile -t lines < "$ROOT_CA_ATTESTATION" || return 1
  [ "${#lines[@]}" -eq 14 ] || return 1
  root_fingerprint="${lines[2]#root_ca_certificate_sha256=}"
  [ "${lines[0]}" = 'format=lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1' ] || return 1
  [ "${lines[1]}" = 'issuer_type=local_root_only_encrypted_systemd_credential_host_bound' ] || return 1
  [ "${lines[2]}" = "root_ca_certificate_sha256=$root_fingerprint" ] || return 1
  [ "${lines[3]}" = "root_ca_certificate_file=$ROOT_CA_CERTIFICATE" ] || return 1
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

assert_root_issuer() {
  local -a fingerprints=()
  local actual
  secure_directory "$CREDENTIALS_PARENT" '750' || fail credentials_parent_security_invalid
  secure_directory "$ROOT_ISSUER_DIRECTORY" '700' || fail root_issuer_directory_security_invalid
  secure_regular_root "$ROOT_CA_KEY_CREDENTIAL" '600' || fail root_ca_credential_security_invalid
  secure_regular_root "$ROOT_CA_CERTIFICATE" '644' || fail root_ca_certificate_security_invalid
  mapfile -t fingerprints < <(read_root_attestation) || fail root_ca_attestation_invalid
  [ "${#fingerprints[@]}" -eq 1 ] || fail root_ca_attestation_invalid
  actual="$(certificate_fingerprint "$ROOT_CA_CERTIFICATE")"
  [ "$actual" = "${fingerprints[0]}" ] || fail root_ca_attestation_invalid
}

TEMPORARY_DIRECTORY=''
STAGE_DIRECTORY=''
TARGET_DIRECTORY=''
TARGET_CREATED='false'
COMPLETE='false'
ROOT_KEY_FILE=''

remove_path() {
  local path="$1"
  [ -z "$path" ] && return 0
  if [ -e "$path" ] || [ -L "$path" ]; then
    rm -rf -- "$path" >/dev/null 2>&1 || return 1
  fi
  [ ! -e "$path" ] && [ ! -L "$path" ]
}

cleanup() {
  if [ "$COMPLETE" != 'true' ] && [ "$TARGET_CREATED" = 'true' ]; then remove_path "$TARGET_DIRECTORY" || true; fi
  if [ "$COMPLETE" != 'true' ]; then remove_path "$STAGE_DIRECTORY" || true; fi
  remove_path "$TEMPORARY_DIRECTORY" || true
}

verify_candidate_directory() {
  local directory="$1"
  local -a entries=()
  secure_directory "$directory" '700' || return 1
  secure_regular_root "$directory/candidate-client-cert.pem.cred" '600' || return 1
  secure_regular_root "$directory/candidate-client-key.pem.cred" '600' || return 1
  secure_regular_root "$directory/candidate.attestation" '644' || return 1
  shopt -s nullglob dotglob
  entries=("$directory"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 3 ] || return 1
}

prepare_candidate() {
  local root_fingerprint intermediate_fingerprint leaf_fingerprint leaf_serial root_certificate_public_key_digest root_private_key_public_key_digest
  command -v openssl >/dev/null 2>&1 || fail openssl_required
  command -v systemd-creds >/dev/null 2>&1 || fail systemd_creds_required
  command -v flock >/dev/null 2>&1 || fail flock_required
  assert_root_issuer
  secure_tmpfs_parent "$PRIVATE_TMPFS_PARENT" || fail private_key_tmpfs_required
  ensure_new_or_secure_directory "$CREDENTIALS_PARENT" "$CANDIDATES_DIRECTORY" '750' '700' candidates_directory_security_invalid
  secure_directory "$STATE_PARENT" '755' || fail state_parent_security_invalid
  if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then secure_regular_root "$LOCK_FILE" '600' || fail lock_file_security_invalid; else : >> "$LOCK_FILE" || fail lock_file_create_failed; chmod 0600 -- "$LOCK_FILE" >/dev/null 2>&1 || fail lock_file_mode_set_failed; chown root:root -- "$LOCK_FILE" >/dev/null 2>&1 || fail lock_file_owner_set_failed; secure_regular_root "$LOCK_FILE" '600' || fail lock_file_security_invalid; fi
  exec 9>>"$LOCK_FILE"
  flock -n 9 || fail candidate_issuance_locked

  TARGET_DIRECTORY="$CANDIDATES_DIRECTORY/generation-$GENERATION"
  [ ! -e "$TARGET_DIRECTORY" ] && [ ! -L "$TARGET_DIRECTORY" ] || fail candidate_generation_exists
  TEMPORARY_DIRECTORY="$(mktemp -d "$PRIVATE_TMPFS_PARENT/lemtel-managed-mtls-candidate.XXXXXX")" || fail temporary_directory_create_failed
  secure_directory "$TEMPORARY_DIRECTORY" '700' || fail temporary_directory_security_invalid
  STAGE_DIRECTORY="$(mktemp -d "$CANDIDATES_DIRECTORY/.generation-$GENERATION.stage.XXXXXX")" || fail stage_directory_create_failed
  secure_directory "$STAGE_DIRECTORY" '700' || fail stage_directory_security_invalid
  ROOT_KEY_FILE="$TEMPORARY_DIRECTORY/root-ca-key.pem"

  systemd-creds decrypt "$ROOT_CA_KEY_CREDENTIAL" "$ROOT_KEY_FILE" >/dev/null 2>&1 || fail root_ca_credential_decryption_failed
  chmod 0600 -- "$ROOT_KEY_FILE" >/dev/null 2>&1 || fail root_ca_key_mode_set_failed
  chown root:root -- "$ROOT_KEY_FILE" >/dev/null 2>&1 || fail root_ca_key_owner_set_failed
  secure_regular_root "$ROOT_KEY_FILE" '600' || fail root_ca_key_security_invalid
  root_certificate_public_key_digest="$(public_key_digest_from_certificate "$ROOT_CA_CERTIFICATE")"
  root_private_key_public_key_digest="$(public_key_digest_from_private_key "$ROOT_KEY_FILE")"
  [ "$root_certificate_public_key_digest" = "$root_private_key_public_key_digest" ] || fail root_ca_key_certificate_mismatch

  openssl ecparam -name prime256v1 -genkey -noout -out "$TEMPORARY_DIRECTORY/intermediate-key.pem" >/dev/null 2>&1 || fail intermediate_key_generation_failed
  openssl req -new -key "$TEMPORARY_DIRECTORY/intermediate-key.pem" -subj "/CN=Lemtel signer mTLS generation $GENERATION intermediate" -out "$TEMPORARY_DIRECTORY/intermediate.csr" >/dev/null 2>&1 || fail intermediate_csr_generation_failed
  printf '%s\n' '[intermediate]' 'basicConstraints=critical,CA:TRUE,pathlen:0' 'keyUsage=critical,keyCertSign,cRLSign' 'subjectKeyIdentifier=hash' 'authorityKeyIdentifier=keyid,issuer' > "$TEMPORARY_DIRECTORY/intermediate-extensions.cnf"
  openssl x509 -req -in "$TEMPORARY_DIRECTORY/intermediate.csr" -CA "$ROOT_CA_CERTIFICATE" -CAkey "$ROOT_KEY_FILE" -CAcreateserial -sha256 -days "$LEAF_VALIDITY_DAYS" -extfile "$TEMPORARY_DIRECTORY/intermediate-extensions.cnf" -extensions intermediate -out "$TEMPORARY_DIRECTORY/intermediate-cert.pem" >/dev/null 2>&1 || fail intermediate_certificate_generation_failed
  openssl ecparam -name prime256v1 -genkey -noout -out "$TEMPORARY_DIRECTORY/leaf-key.pem" >/dev/null 2>&1 || fail leaf_key_generation_failed
  openssl req -new -key "$TEMPORARY_DIRECTORY/leaf-key.pem" -subj "/CN=$CLIENT_COMMON_NAME" -out "$TEMPORARY_DIRECTORY/leaf.csr" >/dev/null 2>&1 || fail leaf_csr_generation_failed
  printf '%s\n' '[leaf]' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature' 'extendedKeyUsage=clientAuth' 'subjectKeyIdentifier=hash' 'authorityKeyIdentifier=keyid,issuer' > "$TEMPORARY_DIRECTORY/leaf-extensions.cnf"
  openssl x509 -req -in "$TEMPORARY_DIRECTORY/leaf.csr" -CA "$TEMPORARY_DIRECTORY/intermediate-cert.pem" -CAkey "$TEMPORARY_DIRECTORY/intermediate-key.pem" -CAcreateserial -sha256 -days "$LEAF_VALIDITY_DAYS" -extfile "$TEMPORARY_DIRECTORY/leaf-extensions.cnf" -extensions leaf -out "$TEMPORARY_DIRECTORY/leaf-cert.pem" >/dev/null 2>&1 || fail leaf_certificate_generation_failed

  root_fingerprint="$(certificate_fingerprint "$ROOT_CA_CERTIFICATE")"
  intermediate_fingerprint="$(certificate_fingerprint "$TEMPORARY_DIRECTORY/intermediate-cert.pem")"
  leaf_fingerprint="$(certificate_fingerprint "$TEMPORARY_DIRECTORY/leaf-cert.pem")"
  [ "$root_fingerprint" != "$intermediate_fingerprint" ] && [ "$root_fingerprint" != "$leaf_fingerprint" ] && [ "$intermediate_fingerprint" != "$leaf_fingerprint" ] || fail certificate_identity_collision
  leaf_serial="$(openssl x509 -in "$TEMPORARY_DIRECTORY/leaf-cert.pem" -noout -serial 2>/dev/null)" || fail leaf_serial_read_failed
  leaf_serial="${leaf_serial#serial=}"
  leaf_serial="$(printf '%s' "$leaf_serial" | tr '[:upper:]' '[:lower:]')"
  [[ "$leaf_serial" =~ ^[a-f0-9]{32,64}$ ]] || fail leaf_serial_invalid

  cat "$TEMPORARY_DIRECTORY/leaf-cert.pem" "$TEMPORARY_DIRECTORY/intermediate-cert.pem" > "$TEMPORARY_DIRECTORY/leaf-cert-chain.pem" || fail leaf_chain_create_failed
  systemd-creds encrypt --with-key=host --name=candidate-client-cert.pem.cred "$TEMPORARY_DIRECTORY/leaf-cert-chain.pem" "$STAGE_DIRECTORY/candidate-client-cert.pem.cred" >/dev/null 2>&1 || fail candidate_certificate_encryption_failed
  systemd-creds encrypt --with-key=host --name=candidate-client-key.pem.cred "$TEMPORARY_DIRECTORY/leaf-key.pem" "$STAGE_DIRECTORY/candidate-client-key.pem.cred" >/dev/null 2>&1 || fail candidate_key_encryption_failed
  chmod 0600 -- "$STAGE_DIRECTORY/candidate-client-cert.pem.cred" "$STAGE_DIRECTORY/candidate-client-key.pem.cred" >/dev/null 2>&1 || fail candidate_credential_mode_set_failed
  chown root:root -- "$STAGE_DIRECTORY/candidate-client-cert.pem.cred" "$STAGE_DIRECTORY/candidate-client-key.pem.cred" >/dev/null 2>&1 || fail candidate_credential_owner_set_failed
  secure_regular_root "$STAGE_DIRECTORY/candidate-client-cert.pem.cred" '600' || fail candidate_certificate_credential_security_invalid
  secure_regular_root "$STAGE_DIRECTORY/candidate-client-key.pem.cred" '600' || fail candidate_key_credential_security_invalid

  printf '%s\n' \
    "format=$ATTESTATION_FORMAT" \
    'state=candidate_prepared' \
    "generation=$GENERATION" \
    "common_name=$CLIENT_COMMON_NAME" \
    "trust_anchor_fingerprint=$root_fingerprint" \
    "intermediate_fingerprint=$intermediate_fingerprint" \
    "leaf_fingerprint=$leaf_fingerprint" \
    "leaf_serial=$leaf_serial" \
    'leaf_maximum_lifetime_seconds=86400' \
    'credential_pair_host_bound_root_only=true' \
    'cleartext_private_material_persisted=false' \
    'relay_activation_authorized=false' \
    'access_policy_activation_authorized=false' \
    'automatic_failover_authorized=false' > "$STAGE_DIRECTORY/candidate.attestation"
  chmod 0644 -- "$STAGE_DIRECTORY/candidate.attestation" >/dev/null 2>&1 || fail candidate_attestation_mode_set_failed
  chown root:root -- "$STAGE_DIRECTORY/candidate.attestation" >/dev/null 2>&1 || fail candidate_attestation_owner_set_failed
  verify_candidate_directory "$STAGE_DIRECTORY" || fail candidate_stage_security_invalid

  rm -f -- "$ROOT_KEY_FILE" "$TEMPORARY_DIRECTORY/intermediate-key.pem" "$TEMPORARY_DIRECTORY/intermediate.csr" "$TEMPORARY_DIRECTORY/intermediate-extensions.cnf" "$TEMPORARY_DIRECTORY/intermediate-cert.srl" "$TEMPORARY_DIRECTORY/leaf-key.pem" "$TEMPORARY_DIRECTORY/leaf.csr" "$TEMPORARY_DIRECTORY/leaf-extensions.cnf" "$TEMPORARY_DIRECTORY/leaf-cert.srl" "$TEMPORARY_DIRECTORY/leaf-cert.pem" "$TEMPORARY_DIRECTORY/leaf-cert-chain.pem" >/dev/null 2>&1 || fail temporary_private_material_cleanup_failed
  ROOT_KEY_FILE=''
  mv -- "$STAGE_DIRECTORY" "$TARGET_DIRECTORY" >/dev/null 2>&1 || fail candidate_commit_failed
  STAGE_DIRECTORY=''
  TARGET_CREATED='true'
  verify_candidate_directory "$TARGET_DIRECTORY" || fail candidate_commit_security_invalid
  remove_path "$TEMPORARY_DIRECTORY" || fail temporary_directory_cleanup_failed
  TEMPORARY_DIRECTORY=''
  COMPLETE='true'

  printf 'do_managed_mtls_leaf_candidate_format=lemtel_do_managed_mtls_leaf_candidate_v1\n'
  printf 'candidate_state=prepared\n'
  printf 'candidate_credentials_written=true\n'
  printf 'candidate_credentials_relay_consumable=false\n'
  printf 'root_ca_credential_contents_returned=false\n'
  printf 'private_key_content_returned=false\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'cloudflare_contacted=false\n'
  printf 'access_policy_configured=false\n'
  printf 'local_relay_activated=false\n'
  printf 'node_enrollment_configured=false\n'
  printf 'node_publisher_configured=false\n'
  printf 'runtime_started=false\n'
  printf 'promotion_executed=false\n'
  printf 'fencing_executed=false\n'
  printf 'automatic_failover_enabled=false\n'
  printf 'telephony_contacted=false\n'
  printf 'do_managed_mtls_leaf_candidate_status=complete\n'
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM
prepare_candidate
