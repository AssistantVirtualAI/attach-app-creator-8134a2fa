#!/bin/bash -p
# Root-only, read-only observation for the Lemtel local mTLS issuer credential.
# It never reads credential or certificate contents and can never satisfy an
# at-rest protection gate on its own.
set -euo pipefail
set +x
umask 077
IFS=$'\n\t'
readonly TRUSTED_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$TRUSTED_PATH"
unset BASH_ENV CDPATH ENV GLOBIGNORE OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES RANDFILE

fail() {
  printf 'do_managed_mtls_storage_observation_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail cli_arguments_forbidden
[ "$(id -u)" -eq 0 ] || fail root_required

readonly WRITER_ROLE='digitalocean_writer'
readonly OBSERVATION_TOKEN='observe_do_managed_mtls_credential_at_rest_root_only'
readonly ETC_DIRECTORY='/etc'
readonly CREDENTIALS_PARENT='/etc/lemtel-platform-signer'
readonly ISSUER_DIRECTORY='/etc/lemtel-platform-signer/managed-ca'
readonly ROOT_CA_KEY_CREDENTIAL='/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred'
readonly ROOT_CA_CERTIFICATE_FILE='/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem'
readonly VAR_DIRECTORY='/var'
readonly VAR_LIB_DIRECTORY='/var/lib'
readonly ATTESTATION_PARENT='/var/lib/lemtel-platform-signer'
readonly ATTESTATION_FILE='/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation'
readonly SYSTEMD_HOST_KEY_PARENT='/var/lib/systemd'
readonly SYSTEMD_HOST_KEY_FILE='/var/lib/systemd/credential.secret'
readonly ATTESTATION_FORMAT='lemtel_do_managed_mtls_local_ca_bootstrap_attestation_v1'
readonly MAX_ATTESTATION_BYTES=4096

[ "${LEMTEL_HA_ROLE:-}" = "$WRITER_ROLE" ] || fail writer_role_required
[ "${LEMTEL_HA_EXECUTE:-}" = "$OBSERVATION_TOKEN" ] || fail execution_token_required

secure_directory() {
  local path="$1" expected_mode="$2" metadata
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  metadata="$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null)" || return 1
  [ "$metadata" = "0:0:${expected_mode}" ]
}

regular_not_symlink() {
  [ -f "$1" ] && [ ! -L "$1" ]
}

root_owned_mode() {
  local path="$1" expected_mode="$2" metadata
  regular_not_symlink "$path" || return 1
  metadata="$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null)" || return 1
  [ "$metadata" = "0:0:${expected_mode}" ]
}

single_link() {
  local links
  regular_not_symlink "$1" || return 1
  links="$(stat -c '%h' -- "$1" 2>/dev/null)" || return 1
  [ "$links" = '1' ]
}

secure_regular_root() {
  regular_not_symlink "$1" && root_owned_mode "$1" "$2" && single_link "$1"
}

issuer_directory_contents_valid() {
  local -a entries=()
  secure_directory "$ISSUER_DIRECTORY" '700' || return 1
  shopt -s nullglob dotglob
  entries=("$ISSUER_DIRECTORY"/*)
  shopt -u nullglob dotglob
  [ "${#entries[@]}" -eq 1 ] || return 1
  [ "${entries[0]}" = "$ROOT_CA_KEY_CREDENTIAL" ] || return 1
  secure_regular_root "$ROOT_CA_KEY_CREDENTIAL" '600'
}

public_attestation_syntax_valid() {
  local -a lines=()
  local root_fingerprint attestation_bytes attestation_hex
  secure_directory "$VAR_DIRECTORY" '755' || return 1
  secure_directory "$VAR_LIB_DIRECTORY" '755' || return 1
  secure_directory "$ATTESTATION_PARENT" '755' || return 1
  secure_regular_root "$ATTESTATION_FILE" '644' || return 1
  attestation_bytes="$(LC_ALL=C wc -c < "$ATTESTATION_FILE" | tr -d '[:space:]')" || return 1
  [[ "$attestation_bytes" =~ ^[0-9]+$ ]] && [ "$attestation_bytes" -gt 0 ] && [ "$attestation_bytes" -le "$MAX_ATTESTATION_BYTES" ] || return 1
  attestation_hex="$(LC_ALL=C od -An -v -tx1 -- "$ATTESTATION_FILE" | tr -d '[:space:]')" || return 1
  [ "${#attestation_hex}" -eq "$((attestation_bytes * 2))" ] || return 1
  case "$attestation_hex" in *00*) return 1 ;; esac
  mapfile -t lines < "$ATTESTATION_FILE"
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
  [[ "$root_fingerprint" =~ ^sha256:[a-f0-9]{64}$ ]]
}

credential_containing_mount_dm_crypt_observation() {
  local filesystem_type='' mount_source='' block_type=''
  [ -f "$ROOT_CA_KEY_CREDENTIAL" ] && [ ! -L "$ROOT_CA_KEY_CREDENTIAL" ] || { printf 'indeterminate'; return 0; }
  filesystem_type="$(findmnt -n -o FSTYPE --target "$ROOT_CA_KEY_CREDENTIAL" 2>/dev/null)" || { printf 'indeterminate'; return 0; }
  mount_source="$(findmnt -n -o SOURCE --target "$ROOT_CA_KEY_CREDENTIAL" 2>/dev/null)" || { printf 'indeterminate'; return 0; }
  case "$filesystem_type" in
    ext4|xfs|btrfs) ;;
    *) printf 'indeterminate'; return 0 ;;
  esac
  [[ "$mount_source" =~ ^/dev/[A-Za-z0-9._/-]+$ ]] || { printf 'indeterminate'; return 0; }
  block_type="$(lsblk -n -o TYPE -- "$mount_source" 2>/dev/null | { IFS= read -r value || true; printf '%s' "${value:-}"; })"
  case "$block_type" in
    crypt) printf 'true' ;;
    disk|part) printf 'false' ;;
    *) printf 'indeterminate' ;;
  esac
}

main() {
  local etc_state='false' credentials_parent_state='false' issuer_directory_state='false' issuer_contents_state='false'
  local credential_regular_state='false' credential_owner_mode_state='false' credential_single_link_state='false' credential_secure_state='false'
  local certificate_regular_state='false' certificate_owner_mode_state='false' certificate_single_link_state='false' certificate_secure_state='false'
  local var_state='false' var_lib_state='false' attestation_parent_state='false' attestation_state='false'
  local systemd_host_key_parent_state='false' systemd_host_key_regular_state='false' systemd_host_key_owner_mode_state='false' systemd_host_key_single_link_state='false' systemd_host_key_secure_state='false'
  local host_bound_claim='unavailable' mount_observation='indeterminate' observation_status='local_evidence_incomplete' terminal_status='incomplete'

  secure_directory "$ETC_DIRECTORY" '755' && etc_state='true'
  secure_directory "$CREDENTIALS_PARENT" '750' && credentials_parent_state='true'
  secure_directory "$ISSUER_DIRECTORY" '700' && issuer_directory_state='true'
  issuer_directory_contents_valid && issuer_contents_state='true'
  regular_not_symlink "$ROOT_CA_KEY_CREDENTIAL" && credential_regular_state='true'
  root_owned_mode "$ROOT_CA_KEY_CREDENTIAL" '600' && credential_owner_mode_state='true'
  single_link "$ROOT_CA_KEY_CREDENTIAL" && credential_single_link_state='true'
  secure_regular_root "$ROOT_CA_KEY_CREDENTIAL" '600' && credential_secure_state='true'
  regular_not_symlink "$ROOT_CA_CERTIFICATE_FILE" && certificate_regular_state='true'
  root_owned_mode "$ROOT_CA_CERTIFICATE_FILE" '644' && certificate_owner_mode_state='true'
  single_link "$ROOT_CA_CERTIFICATE_FILE" && certificate_single_link_state='true'
  secure_regular_root "$ROOT_CA_CERTIFICATE_FILE" '644' && certificate_secure_state='true'
  secure_directory "$VAR_DIRECTORY" '755' && var_state='true'
  secure_directory "$VAR_LIB_DIRECTORY" '755' && var_lib_state='true'
  secure_directory "$ATTESTATION_PARENT" '755' && attestation_parent_state='true'
  public_attestation_syntax_valid && attestation_state='true'
  secure_directory "$SYSTEMD_HOST_KEY_PARENT" '755' && systemd_host_key_parent_state='true'
  regular_not_symlink "$SYSTEMD_HOST_KEY_FILE" && systemd_host_key_regular_state='true'
  root_owned_mode "$SYSTEMD_HOST_KEY_FILE" '400' && systemd_host_key_owner_mode_state='true'
  single_link "$SYSTEMD_HOST_KEY_FILE" && systemd_host_key_single_link_state='true'
  secure_regular_root "$SYSTEMD_HOST_KEY_FILE" '400' && systemd_host_key_secure_state='true'
  if [ "$attestation_state" = 'true' ]; then
    host_bound_claim='declared_unverified'
  fi

  mount_observation="$(credential_containing_mount_dm_crypt_observation)"
  if [ "$etc_state" = 'true' ] && [ "$credentials_parent_state" = 'true' ] && [ "$issuer_directory_state" = 'true' ] && [ "$issuer_contents_state" = 'true' ] && [ "$credential_secure_state" = 'true' ] && [ "$certificate_secure_state" = 'true' ] && [ "$var_state" = 'true' ] && [ "$var_lib_state" = 'true' ] && [ "$attestation_parent_state" = 'true' ] && [ "$attestation_state" = 'true' ] && [ "$systemd_host_key_parent_state" = 'true' ] && [ "$systemd_host_key_secure_state" = 'true' ]; then
    case "$mount_observation" in
      true) observation_status='local_evidence_positive_observation_only'; terminal_status='observed_without_gate' ;;
      false) observation_status='local_evidence_observed_negative'; terminal_status='observed_negative' ;;
      *) observation_status='local_evidence_indeterminate'; terminal_status='indeterminate' ;;
    esac
  fi

  printf 'do_managed_mtls_storage_observation_format=lemtel_managed_mtls_credential_local_at_rest_observation_v1\n'
  printf 'observation_status=%s\n' "$observation_status"
  printf 'subject=managed_root_ca_key_credential\n'
  printf 'root_only_execution=true\n'
  printf 'etc_directory_root_owned_0755=%s\n' "$etc_state"
  printf 'credential_parent_root_owned_0750=%s\n' "$credentials_parent_state"
  printf 'issuer_directory_root_owned_0700=%s\n' "$issuer_directory_state"
  printf 'issuer_directory_expected_contents_only=%s\n' "$issuer_contents_state"
  printf 'credential_regular_not_symlink=%s\n' "$credential_regular_state"
  printf 'credential_root_owned_0600=%s\n' "$credential_owner_mode_state"
  printf 'credential_single_link=%s\n' "$credential_single_link_state"
  printf 'credential_secure_metadata=%s\n' "$credential_secure_state"
  printf 'public_certificate_regular_not_symlink=%s\n' "$certificate_regular_state"
  printf 'public_certificate_root_owned_0644=%s\n' "$certificate_owner_mode_state"
  printf 'public_certificate_single_link=%s\n' "$certificate_single_link_state"
  printf 'public_certificate_secure_metadata=%s\n' "$certificate_secure_state"
  printf 'var_directory_root_owned_0755=%s\n' "$var_state"
  printf 'var_lib_directory_root_owned_0755=%s\n' "$var_lib_state"
  printf 'attestation_parent_root_owned_0755=%s\n' "$attestation_parent_state"
  printf 'bootstrap_public_attestation_syntax_valid=%s\n' "$attestation_state"
  printf 'host_bound_claim_from_public_attestation=%s\n' "$host_bound_claim"
  printf 'systemd_host_key_parent_root_owned_0755=%s\n' "$systemd_host_key_parent_state"
  printf 'systemd_host_key_regular_not_symlink=%s\n' "$systemd_host_key_regular_state"
  printf 'systemd_host_key_root_owned_0400=%s\n' "$systemd_host_key_owner_mode_state"
  printf 'systemd_host_key_single_link=%s\n' "$systemd_host_key_single_link_state"
  printf 'systemd_host_key_secure_metadata=%s\n' "$systemd_host_key_secure_state"
  printf 'credential_contents_read=false\n'
  printf 'certificate_pem_read=false\n'
  printf 'private_key_material_returned=false\n'
  printf 'credential_encryption_format_verified=false\n'
  printf 'credential_containing_mount_dm_crypt_observed=%s\n' "$mount_observation"
  printf 'luks_mapping_observed=indeterminate\n'
  printf 'swap_risk_not_assessed=true\n'
  printf 'host_key_storage_protection=not_verified\n'
  printf 'provider_storage_encryption=not_assessable_from_guest\n'
  printf 'offline_attack_resistance=not_proven\n'
  printf 'network_contacted=false\n'
  printf 'provider_contacted=false\n'
  printf 'cloudflare_contacted=false\n'
  printf 'systemctl_contacted=false\n'
  printf 'timers_read_or_modified=false\n'
  printf 'routes_read_or_modified=false\n'
  printf 'database_contacted=false\n'
  printf 'promotion_executed=false\n'
  printf 'fencing_executed=false\n'
  printf 'failover_executed=false\n'
  printf 'activation_authorized=false\n'
  printf 'relay_authorized=false\n'
  printf 'ha_gate_satisfied=false\n'
  printf 'do_managed_mtls_storage_observation_status=%s\n' "$terminal_status"
  exit 78
}

main
