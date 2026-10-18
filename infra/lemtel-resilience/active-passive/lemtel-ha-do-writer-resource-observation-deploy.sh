#!/usr/bin/env bash
# Root-only DO-writer deployment of redacted do-writer-resource prerequisites.
# It never configures a publisher, sends an observation, or changes routing.
set -euo pipefail
set +x

fail() {
  printf 'do_writer_resource_observation_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_DO_WRITER_RESOURCE_OBSERVATION_EXECUTE:-}" = deploy_verified_do_writer_resource_observation ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_DO_WRITER_RESOURCE_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ] || fail fresh_snapshot_attestation_required

archive="${LEMTEL_DO_WRITER_RESOURCE_OBSERVATION_ARCHIVE:-/home/lemtelops/lemtel-do-writer-resource-observation.tar}"
archive_digest="${archive}.sha256"
backup_root='/var/lib/lemtel-ha/do-writer-resource-observation/backups'
edge_container='supabase-edge-functions'

[[ "$archive" = /* && "$archive" != *$'\n'* ]] || fail archive_path_invalid

required_files=(
 '0022_lemtel_do_writer_resource_current.sql'
 'deployment-metadata.json'
 'lemtel-do-writer-resource-deployment-manifest.json'
 'lemtel-do-writer-resource-ingest.index.ts'
 'lemtel-onboarding-admin.index.ts'
)
# The manifest authenticates the seven payload files but is itself an archive member.
# Keep the archive allowlist explicit so malformed or extra members are refused.
archive_entries=(
  "${required_files[@]}"
  'manifest.sha256'
)

secure_regular_file() {
  local path="$1" mode
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  [ "$(stat -c '%u' "$path")" = 0 ] || return 1
  mode="$(stat -c '%a' "$path")"
  [ $((8#$mode & 022)) -eq 0 ]
}

verify_archive() {
  local actual expected recorded
  secure_regular_file "$archive" || fail archive_security_invalid
  secure_regular_file "$archive_digest" || fail archive_digest_security_invalid
  [ "$(stat -c '%s' "$archive")" -gt 0 ] && [ "$(stat -c '%s' "$archive")" -le $((5 * 1024 * 1024)) ] || fail archive_size_invalid
  [ "$(stat -c '%s' "$archive_digest")" -gt 0 ] && [ "$(stat -c '%s' "$archive_digest")" -le 200 ] || fail archive_digest_size_invalid
  actual="$(sha256sum "$archive" | awk '{print $1}')"
  expected="$(awk 'NR == 1 { print $1 }' "$archive_digest")"
  recorded="$(cat "$archive_digest")"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail archive_digest_invalid
  [ "$recorded" = "$expected  $(basename "$archive")" ] || fail archive_digest_invalid
  [ "$actual" = "$expected" ] || fail archive_digest_mismatch
}

verify_archive_layout() {
 local -a entries=()
 mapfile -t entries < <(tar -tf "$archive")
 [ "${#entries[@]}" -eq "${#archive_entries[@]}" ] || fail archive_layout_invalid
 local index
 for index in "${!archive_entries[@]}"; do [ "${entries[$index]}" = "${archive_entries[$index]}" ] || fail archive_layout_invalid; done
 [ "$(tar -tvf "$archive" | awk '{print substr($1, 1, 1)}' | sort -u)" = '-' ] || fail archive_member_type_invalid
}

verify_stage_manifest() {
  local path="$1" expected actual manifest_names expected_names
  [ -s "$path/manifest.sha256" ] && [ ! -L "$path/manifest.sha256" ] || fail bundle_manifest_missing
  manifest_names="$(awk 'NF == 2 && $1 ~ /^[a-f0-9]{64}$/ { print $2 }' "$path/manifest.sha256" | sort)"
  expected_names="$(printf '%s\n' "${required_files[@]}" | sort)"
  [ "$manifest_names" = "$expected_names" ] || fail bundle_manifest_invalid
  [ "$(awk 'END { print NR }' "$path/manifest.sha256")" -eq "${#required_files[@]}" ] || fail bundle_manifest_invalid
  for path in "${required_files[@]}"; do
    [ -s "$stage/$path" ] && [ ! -L "$stage/$path" ] || fail bundle_file_missing
    expected="$(awk -v file="$path" '$2 == file { print $1 }' "$stage/manifest.sha256")"
    actual="$(sha256sum "$stage/$path" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || fail bundle_digest_mismatch
  done
}

verify_metadata() {
  python3 - "$stage/deployment-metadata.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as stream: value = json.load(stream)
    required = {'package_format': 'lemtel_do_writer_resource_observation_package_v1', 'scope': 'do_writer_redacted_resource_observation_prerequisites', 'target_role': 'digitalocean_writer', 'snapshot_attestation_required': True, 'schema_migration': '0022_lemtel_do_writer_resource_current.sql', 'schema_apply_idempotent': True, 'edge_runtime_restart_required': True}
    forbidden = ('secrets_in_bundle', 'publisher_configuration_written', 'publisher_installed', 'publisher_timer_enabled', 'standby_runtime_started', 'caddy_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read', 'deployment_authorized', 'activation_authorized')
    if any(value.get(key) != expected for key, expected in required.items()) or any(value.get(key) is not False for key in forbidden): raise ValueError('metadata')
except Exception: raise SystemExit(1)
PY
}

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

schema_state() {
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "WITH objects(present) AS (VALUES (to_regclass('"'"'public.lemtel_do_writer_resource_current'"'"') IS NOT NULL), (to_regprocedure('"'"'public.lemtel_record_do_writer_resource_status(timestamp with time zone,integer,integer,integer,integer,integer,integer)'"'"') IS NOT NULL)) SELECT CASE WHEN count(*) FILTER (WHERE present) = 0 THEN '"'"'absent'"'"' WHEN count(*) FILTER (WHERE present) = 2 THEN '"'"'present'"'"' ELSE '"'"'partial'"'"' END FROM objects"' 2>/dev/null | tr -d '\r\n'
}

apply_migration_idempotently() {
  local before after
  before="$(schema_state || true)"
  case "$before" in
    absent)
      docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$stage/0022_lemtel_do_writer_resource_current.sql"
      migration_result=applied
      ;;
    present) migration_result=already_present ;;
    *) fail schema_state_ambiguous ;;
  esac
  after="$(schema_state || true)"
  [ "$after" = present ] || fail schema_verification_failed
}

stage=''
backup_dir=''
admin_target=''
ingest_target=''
ingest_dir=''
admin_backup=''
ingest_preexisting=false
ingest_directory_created=false
admin_replaced=false
ingest_replaced=false
admin_temp=''
ingest_temp=''
committed=false
migration_result=not_attempted

rollback() {
  local code=$?
  trap - EXIT INT TERM
  if [ "$committed" != true ] && { [ "$admin_replaced" = true ] || [ "$ingest_replaced" = true ]; }; then
    if [ "$admin_replaced" = true ]; then cp -- "$admin_backup" "$admin_target" || true; fi
    if [ "$ingest_replaced" = true ]; then
      if [ "$ingest_preexisting" = true ]; then cp -- "$backup_dir/lemtel-do-writer-resource-ingest.index.ts" "$ingest_target" || true
      else rm -f -- "$ingest_target" || true; fi
    fi
    docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true
    printf 'do_writer_resource_observation_sources_rollback=attempted\n' >&2
    printf 'do_writer_resource_observation_migration_rollback=not_attempted_additive_migration_remains\n' >&2
  fi
  if [ "$committed" != true ] && [ "$ingest_directory_created" = true ]; then rmdir -- "$ingest_dir" 2>/dev/null || true; fi
  rm -f -- "${admin_temp:-}" "${ingest_temp:-}" || true
  [ -z "$stage" ] || rm -rf -- "$stage" || true
  exit "$code"
}

verify_archive
verify_archive_layout
command -v docker >/dev/null 2>&1 || fail docker_missing

db_container="$(resolve_database_container || true)"
[ -n "$db_container" ] || fail database_container_unresolved
for container in "$db_container" "$edge_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail writer_not_verified

functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$functions_source" ] && [ -d "$functions_source" ] && [ ! -L "$functions_source" ] || fail runtime_mount_missing
admin_target="$functions_source/lemtel-onboarding-admin/index.ts"
ingest_dir="$functions_source/lemtel-do-writer-resource-ingest"
ingest_target="$ingest_dir/index.ts"
[ -f "$admin_target" ] && [ ! -L "$admin_target" ] && [ ! -L "$(dirname "$admin_target")" ] || fail admin_target_missing
if [ -e "$ingest_target" ]; then [ -f "$ingest_target" ] && [ ! -L "$ingest_target" ] || fail ingest_target_invalid; ingest_preexisting=true; fi
if [ -e "$ingest_dir" ]; then [ -d "$ingest_dir" ] && [ ! -L "$ingest_dir" ] || fail ingest_directory_invalid; fi

lock_file='/var/lock/lemtel-do-writer-resource-observation.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_deploy
install -d -o root -g root -m 0700 "$backup_root"
stage="$(mktemp -d "$backup_root/.package.XXXXXX")"
tar -xf "$archive" -C "$stage" --no-same-owner --no-same-permissions
verify_stage_manifest "$stage"
verify_metadata

install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
admin_backup="$backup_dir/lemtel-onboarding-admin.index.ts"
cp --preserve=mode,ownership,timestamps "$admin_target" "$admin_backup"
if [ "$ingest_preexisting" = true ]; then cp --preserve=mode,ownership,timestamps "$ingest_target" "$backup_dir/lemtel-do-writer-resource-ingest.index.ts"; fi

trap rollback EXIT
trap 'exit 1' INT TERM
apply_migration_idempotently

if [ "$ingest_preexisting" = false ]; then
  install -d -o root -g root -m 0755 "$ingest_dir"
  ingest_directory_created=true
fi
admin_temp="$(mktemp "${admin_target}.lemtel-do-writer-resource.XXXXXX")"
ingest_temp="$(mktemp "${ingest_target}.lemtel-do-writer-resource.XXXXXX")"
cp -- "$stage/lemtel-onboarding-admin.index.ts" "$admin_temp"
cp -- "$stage/lemtel-do-writer-resource-ingest.index.ts" "$ingest_temp"
chmod --reference="$admin_target" "$admin_temp"
if [ "$ingest_preexisting" = true ]; then chmod --reference="$ingest_target" "$ingest_temp"; else chmod 0644 "$ingest_temp"; fi
[ "$(sha256sum "$admin_temp" | awk '{print $1}')" = "$(sha256sum "$stage/lemtel-onboarding-admin.index.ts" | awk '{print $1}')" ] || fail admin_stage_digest_mismatch
[ "$(sha256sum "$ingest_temp" | awk '{print $1}')" = "$(sha256sum "$stage/lemtel-do-writer-resource-ingest.index.ts" | awk '{print $1}')" ] || fail ingest_stage_digest_mismatch
mv -f -- "$admin_temp" "$admin_target"
admin_replaced=true
mv -f -- "$ingest_temp" "$ingest_target"
ingest_replaced=true

docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart
[ "$(sha256sum "$admin_target" | awk '{print $1}')" = "$(sha256sum "$stage/lemtel-onboarding-admin.index.ts" | awk '{print $1}')" ] || fail admin_target_digest_mismatch
[ "$(sha256sum "$ingest_target" | awk '{print $1}')" = "$(sha256sum "$stage/lemtel-do-writer-resource-ingest.index.ts" | awk '{print $1}')" ] || fail ingest_target_digest_mismatch
grep -Fq 'action: "get_do_writer_resources"' "$admin_target" || fail admin_extension_missing
grep -Fq 'lemtel_do_writer_resource_current' "$admin_target" || fail admin_extension_missing
grep -Fq 'lemtel_record_do_writer_resource_status' "$ingest_target" || fail ingest_function_missing

committed=true
rm -rf -- "$stage"
stage=''
trap - EXIT INT TERM
printf 'do_writer_resource_observation_deploy_format=lemtel_do_writer_resource_observation_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'snapshot_attestation=verified\n'
printf 'schema_0022=%s\n' "$migration_result"
printf 'edge_sources=replaced\n'
printf 'edge_runtime=restarted_and_running\n'
printf 'publisher_configuration_written=false\n'
printf 'publisher_installed=false\n'
printf 'publisher_timer_enabled=false\n'
printf 'standby_runtime_started=false\n'
printf 'caddy_changed=false\n'
printf 'provider_contacted=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'business_data_read=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_resource_observation_deploy_status=complete\n'
