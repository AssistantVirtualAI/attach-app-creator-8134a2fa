#!/usr/bin/env bash
# Root-only creation of an encrypted, inactive Supabase/Edge runtime envelope for the DO standby.
# Database and Storage data stay on their dedicated replication paths and are never added here.
set -euo pipefail

fail() {
  printf 'primary_runtime_envelope_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'create_private_standby_runtime_envelope' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

compose_dir='/opt/lemtel-staging-bootstrap/lemtel-supabase'
stage_dir='/var/lib/lemtel-ha/runtime-envelope'
envelope_file="$stage_dir/lemtel-standby-runtime.age"
manifest_file="$stage_dir/lemtel-standby-runtime.manifest"
age_recipient="${LEMTEL_HA_STANDBY_AGE_RECIPIENT:-}"

case "$age_recipient" in age1[0-9a-z]*) ;; *) fail invalid_standby_age_recipient ;; esac
command -v age >/dev/null 2>&1 || fail age_missing
command -v tar >/dev/null 2>&1 || fail tar_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
[ -d "$compose_dir" ] || fail compose_directory_missing
[ ! -e "$envelope_file" ] || fail envelope_already_exists
[ ! -e "$manifest_file" ] || fail manifest_already_exists

# Validate the recipient before handling any configuration file.
printf '' | age -r "$age_recipient" -o /dev/null || fail invalid_standby_age_recipient

runtime_paths=(
  .env
  docker-compose.yml
  docker-compose.caddy.yml
  docker-compose.lemtel-private.yml
  docker-compose.lemtel-db-init.yml
  volumes/functions
  volumes/proxy/caddy
)

cd "$compose_dir"
for path in "${runtime_paths[@]}"; do
  [ -e "$path" ] || fail "runtime_path_missing_$(basename "$path")"
  [ ! -L "$path" ] || fail "runtime_path_symlink_$(basename "$path")"
  if find "$path" -type l -print -quit | grep -q .; then
    fail "runtime_tree_symlink_$(basename "$path")"
  fi
done

install -d -o root -g root -m 0700 "$stage_dir"
tar_file="$(mktemp "$stage_dir/.runtime.XXXXXX.tar")"
cleanup() { rm -f "$tar_file"; }
trap cleanup EXIT

tar --create --file "$tar_file" --numeric-owner --format=posix "${runtime_paths[@]}"

# Defend against path traversal and against accidentally including replicated data volumes.
if tar -tf "$tar_file" | grep -Eq '(^/|(^|/)\.\.(/|$)|^volumes/(db|storage)(/|$))'; then
  fail envelope_content_unsafe
fi
if tar -tvf "$tar_file" | grep -q '^l'; then
  fail envelope_contains_symlink
fi

age -r "$age_recipient" -o "$envelope_file" "$tar_file"
chmod 0600 "$envelope_file"
envelope_sha256="$(sha256sum "$envelope_file" | awk '{print $1}')"
tmp_manifest="$(mktemp "$stage_dir/.manifest.XXXXXX")"
{
  printf 'format=lemtel_standby_runtime_envelope_v1\n'
  printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'encrypted_envelope_sha256=%s\n' "$envelope_sha256"
  printf 'included_runtime_paths=%s\n' "$(IFS=,; printf '%s' "${runtime_paths[*]}")"
  printf 'database_data_included=false\n'
  printf 'storage_data_included=false\n'
  printf 'plaintext_values_emitted=false\n'
} > "$tmp_manifest"
chmod 0600 "$tmp_manifest"
mv -f "$tmp_manifest" "$manifest_file"

printf 'primary_runtime_envelope_format=lemtel_primary_runtime_envelope_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'runtime_envelope_created=true\n'
printf 'runtime_envelope_encrypted=true\n'
printf 'runtime_manifest_created=true\n'
printf 'database_data_included=false\n'
printf 'storage_data_included=false\n'
printf 'runtime_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'dns_change_executed=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_runtime_envelope_status=complete\n'
