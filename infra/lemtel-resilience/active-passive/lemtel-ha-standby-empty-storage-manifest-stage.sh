#!/usr/bin/env bash
# Root-only recovery for a proven-empty Storage receiver after a fenced promotion.
# It stages only the valid zero-byte checksum manifest; it never copies data or starts runtime services.
set -euo pipefail

fail() {
  printf 'standby_empty_storage_manifest_stage_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'stage_empty_storage_manifest_after_verified_empty_storage' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role
[ "${LEMTEL_HA_ALLOW_EMPTY_STORAGE_MANIFEST:-}" = 'I_UNDERSTAND_THIS_STAGES_ONLY_A_VERIFIED_EMPTY_STORAGE_MANIFEST' ] || fail empty_storage_manifest_acknowledgement_required

receiver_dir='/home/lemtelstorage/storage-current'
receiver_user='lemtelstorage'
attestation='/home/lemtelops/.lemtel-ha/storage-last-success'
destination="$receiver_dir/.lemtel-ha-manifest.current.sha256"
empty_manifest_sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

[ -d "$receiver_dir" ] || fail standby_storage_receiver_missing
[ -s "$attestation" ] || fail primary_storage_attestation_missing
id "$receiver_user" >/dev/null 2>&1 || fail standby_storage_receiver_user_missing

manifest_name="$(sed -n 's/^manifest_name=//p' "$attestation" | sed -n '1p')"
manifest_hash="$(sed -n 's/^manifest_sha256=//p' "$attestation" | sed -n '1p')"
source_file_count="$(sed -n 's/^source_file_count=//p' "$attestation" | sed -n '1p')"
case "$manifest_name" in storage-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.sha256) ;; *) fail primary_storage_manifest_name_invalid ;; esac
[ "$manifest_hash" = "$empty_manifest_sha256" ] || fail primary_storage_manifest_not_empty
[ "$source_file_count" = '0' ] || fail primary_storage_file_count_not_empty

# Any payload file, including an unfinished transfer partial, makes an empty attestation unsafe.
receiver_data_file_count="$(find "$receiver_dir" -xdev -type f ! -name '.lemtel-ha-manifest.current.sha256' -printf . | wc -c)"
[ "$receiver_data_file_count" = '0' ] || fail standby_storage_file_count_not_empty
if [ -e "$destination" ]; then
  [ -f "$destination" ] || fail existing_standby_manifest_invalid
  [ ! -s "$destination" ] || fail existing_standby_manifest_not_empty
fi

umask 077
temporary_manifest="$(mktemp "$receiver_dir/.lemtel-ha-manifest.current.XXXXXX")"
cleanup() { rm -f "$temporary_manifest"; }
trap cleanup EXIT
: > "$temporary_manifest"
chown "$receiver_user:$receiver_user" "$temporary_manifest"
chmod 0600 "$temporary_manifest"
mv -f "$temporary_manifest" "$destination"
trap - EXIT

[ -f "$destination" ] || fail staged_storage_manifest_missing
[ ! -s "$destination" ] || fail staged_storage_manifest_not_empty
[ "$(sha256sum "$destination" | awk '{ print $1 }')" = "$empty_manifest_sha256" ] || fail staged_storage_manifest_hash_invalid

printf 'standby_empty_storage_manifest_stage_format=lemtel_empty_storage_manifest_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'primary_empty_storage_attestation_verified=true\n'
printf 'standby_empty_storage_verified=true\n'
printf 'storage_manifest_staged=true\n'
printf 'storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_empty_storage_manifest_stage_status=complete\n'
