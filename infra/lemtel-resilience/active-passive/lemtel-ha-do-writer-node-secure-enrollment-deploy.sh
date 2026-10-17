#!/usr/bin/env bash
# Root-only DO-writer deployment of signed node-enrollment server prerequisites.
# It never configures keys, a publisher, a route, a timer, a service, or a standby runtime.
set -euo pipefail
set +x

fail() {
  printf 'node_secure_enrollment_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_NODE_ENROLLMENT_DEPLOY_EXECUTE:-}" = deploy_verified_node_enrollment ] || fail execution_token_required
[ "${LEMTEL_NODE_ENROLLMENT_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ] || fail fresh_snapshot_attestation_required

archive="${LEMTEL_NODE_ENROLLMENT_ARCHIVE:-/home/lemtelops/lemtel-node-secure-enrollment.tar}"
archive_digest="${archive}.sha256"
backup_root='/var/lib/lemtel-ha/node-secure-enrollment/backups'
edge_container='supabase-edge-functions'

[[ "$archive" = /* && "$archive" != *$'\n'* ]] || fail archive_path_invalid

# Keep this allowlist in bytewise archive order. manifest.sha256 deliberately
# authenticates only payload files and is separately admitted as an archive member.
required_files=(
  '0021_lemtel_node_secure_enrollment.sql'
  'deployment-metadata.json'
  'lemtel-node-enrollment-admin.index.ts'
  'lemtel-node-enrollment-admin.manifest.json'
  'lemtel-node-enrollment.index.ts'
  'lemtel-node-enrollment.manifest.json'
  'lemtel-node-secure-enrollment-manifest.json'
  'lemtel-node-status-signed-ingest.index.ts'
  'lemtel-node-status-signed-ingest.manifest.json'
  'lemtel-onboarding-admin.index.ts'
  'lemtel-onboarding-admin.manifest.json'
  'lemtelExternalPlatformSigner.ts'
  'lemtelNodeEnrollment.ts'
  'lemtelNodeEnrollmentBackend.ts'
)
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
  local directory="$1" path expected actual manifest_names expected_names
  [ -s "$directory/manifest.sha256" ] && [ ! -L "$directory/manifest.sha256" ] || fail bundle_manifest_missing
  manifest_names="$(awk 'NF == 2 && $1 ~ /^[a-f0-9]{64}$/ { print $2 }' "$directory/manifest.sha256" | sort)"
  expected_names="$(printf '%s\n' "${required_files[@]}" | sort)"
  [ "$manifest_names" = "$expected_names" ] || fail bundle_manifest_invalid
  [ "$(awk 'END { print NR }' "$directory/manifest.sha256")" -eq "${#required_files[@]}" ] || fail bundle_manifest_invalid
  for path in "${required_files[@]}"; do
    [ -s "$directory/$path" ] && [ ! -L "$directory/$path" ] || fail bundle_file_missing
    expected="$(awk -v file="$path" '$2 == file { print $1 }' "$directory/manifest.sha256")"
    actual="$(sha256sum "$directory/$path" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || fail bundle_digest_mismatch
  done
}

verify_metadata() {
  python3 - "$stage/deployment-metadata.json" <<'PY'
import json
import re
import sys
try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        value = json.load(stream)
    required = {
        'package_format': 'lemtel_node_secure_enrollment_do_writer_package_v1',
        'scope': 'do_writer_signed_node_enrollment_server_prerequisites',
        'target_role': 'digitalocean_writer',
        'snapshot_attestation_required': True,
        'node_status_schema_prerequisite': '0020_lemtel_node_status_observations.sql',
        'node_status_schema_apply': False,
        'schema_migration': '0021_lemtel_node_secure_enrollment.sql',
        'schema_apply_idempotent': True,
        'edge_runtime_restart_required': True,
    }
    forbidden = (
        'secrets_in_bundle', 'secret_configuration_written', 'publisher_configuration_written',
        'publisher_installed', 'publisher_timer_enabled', 'agent_installed', 'agent_activated',
        'service_activated', 'timer_activated', 'standby_runtime_started', 'caddy_changed',
        'routes_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed',
        'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read',
        'deployment_authorized', 'activation_authorized',
    )
    if (not isinstance(value.get('source_revision'), str) or not re.fullmatch(r'[a-f0-9]{40}', value['source_revision'])
            or any(value.get(key) != expected for key, expected in required.items())
            or any(value.get(key) is not False for key in forbidden)):
        raise ValueError('metadata')
except Exception:
    raise SystemExit(1)
PY
}

verify_source_manifest() {
  python3 - "$stage" <<'PY'
import hashlib
import json
import os
import sys
try:
    directory = sys.argv[1]
    with open(os.path.join(directory, 'lemtel-node-secure-enrollment-manifest.json'), encoding='utf-8') as stream:
        manifest = json.load(stream)
    if (manifest.get('package_version') != 'lemtel_node_secure_enrollment_source_package_v1'
            or manifest.get('scope') != 'lemtel_only_offline_publication_enrollment'
            or manifest.get('deployment_authorized') is not False
            or manifest.get('activation_authorized') is not False
            or manifest.get('schema_apply_authorized') is not False
            or manifest.get('remote_commands_authorized') is not False):
        raise ValueError('manifest')
    digests = {}
    for section in ('migration_sources', 'edge_sources', 'dependencies'):
        for item in manifest.get(section, []):
            path, digest = item.get('path'), item.get('sha256')
            if not isinstance(path, str) or not isinstance(digest, str) or not __import__('re').fullmatch(r'[a-f0-9]{64}', digest) or path in digests:
                raise ValueError('manifest')
            digests[path] = digest
    required = {
        'infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql': '0021_lemtel_node_secure_enrollment.sql',
        'infra/lemtel-self-hosted/functions/_shared/lemtelExternalPlatformSigner.ts': 'lemtelExternalPlatformSigner.ts',
        'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts': 'lemtelNodeEnrollment.ts',
        'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollmentBackend.ts': 'lemtelNodeEnrollmentBackend.ts',
        'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.ts': 'lemtel-node-enrollment.index.ts',
        'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/manifest.json': 'lemtel-node-enrollment.manifest.json',
        'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/index.ts': 'lemtel-node-enrollment-admin.index.ts',
        'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/manifest.json': 'lemtel-node-enrollment-admin.manifest.json',
        'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/index.ts': 'lemtel-node-status-signed-ingest.index.ts',
        'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/manifest.json': 'lemtel-node-status-signed-ingest.manifest.json',
        'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts': 'lemtel-onboarding-admin.index.ts',
    }
    for source, bundled in required.items():
        with open(os.path.join(directory, bundled), 'rb') as stream:
            actual = hashlib.sha256(stream.read()).hexdigest()
        if digests.get(source) != actual:
            raise ValueError('source digest')
except Exception:
    raise SystemExit(1)
PY
}

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

node_status_schema_state() {
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "WITH objects(present) AS (VALUES (to_regclass('\''public.lemtel_node_status_current'\'') IS NOT NULL), (to_regclass('\''public.lemtel_node_status_history'\'') IS NOT NULL), (to_regclass('\''public.lemtel_node_status_history_observed_at_idx'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_status_history_retention()'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_record_node_status(text,timestamp with time zone,text,text,text,text)'\'') IS NOT NULL), (EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_row JOIN pg_catalog.pg_class table_row ON table_row.oid = trigger_row.tgrelid JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace WHERE namespace_row.nspname = '\''public'\'' AND table_row.relname = '\''lemtel_node_status_history'\'' AND trigger_row.tgname = '\''lemtel_node_status_history_retention_before_insert'\'' AND NOT trigger_row.tgisinternal))) SELECT CASE WHEN count(*) FILTER (WHERE present) = 0 THEN '\''absent'\'' WHEN count(*) FILTER (WHERE present) = 6 THEN '\''complete'\'' ELSE '\''partial'\'' END FROM objects"' 2>/dev/null | tr -d '\r\n'
}

enrollment_schema_state() {
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "WITH objects(present) AS (VALUES (to_regclass('\''public.lemtel_node_enrollments'\'') IS NOT NULL), (to_regclass('\''public.lemtel_node_enrollment_audit'\'') IS NOT NULL), (to_regclass('\''public.lemtel_node_one_publication_grant'\'') IS NOT NULL), (to_regclass('\''public.lemtel_node_unique_challenge_nonce'\'') IS NOT NULL), (COALESCE((SELECT relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '\''public'\'' AND c.relname = '\''lemtel_node_enrollments'\''), false)), (COALESCE((SELECT relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '\''public'\'' AND c.relname = '\''lemtel_node_enrollment_audit'\''), false)), (to_regprocedure('\''public.lemtel_node_enrollment_is_admin(uuid)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_require_admin(uuid)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_redacted(uuid)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_invite(uuid,text,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_read(uuid,uuid)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_challenge(uuid,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_attest(uuid,text,text,text,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_approve(uuid,uuid,text,text,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_revoke(uuid,uuid,text,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_enrollment_claim(uuid,text,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_node_publication_lookup(uuid,text,text)'\'') IS NOT NULL), (to_regprocedure('\''public.lemtel_record_enrolled_node_status(uuid,text,text,bigint,timestamp with time zone,text,text,text,text)'\'') IS NOT NULL)) SELECT CASE WHEN count(*) FILTER (WHERE present) = 0 THEN '\''absent'\'' WHEN count(*) FILTER (WHERE present) = 18 THEN '\''complete'\'' ELSE '\''partial'\'' END FROM objects"' 2>/dev/null | tr -d '\r\n'
}

apply_enrollment_migration_idempotently() {
  local before after
  before="$(enrollment_schema_state || true)"
  case "$before" in
    absent)
      docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$stage/0021_lemtel_node_secure_enrollment.sql"
      migration_result=applied
      ;;
    complete) migration_result=already_present ;;
    partial) fail enrollment_schema_state_ambiguous ;;
    *) fail enrollment_schema_state_unreadable ;;
  esac
  after="$(enrollment_schema_state || true)"
  [ "$after" = complete ] || fail enrollment_schema_verification_failed
}

stage=''
backup_dir=''
functions_source=''
declare -a package_files=(
  'lemtelExternalPlatformSigner.ts'
  'lemtelNodeEnrollment.ts'
  'lemtelNodeEnrollmentBackend.ts'
  'lemtel-node-enrollment.index.ts'
  'lemtel-node-enrollment.manifest.json'
  'lemtel-node-enrollment-admin.index.ts'
  'lemtel-node-enrollment-admin.manifest.json'
  'lemtel-node-status-signed-ingest.index.ts'
  'lemtel-node-status-signed-ingest.manifest.json'
  'lemtel-onboarding-admin.index.ts'
  'lemtel-onboarding-admin.manifest.json'
)
declare -a target_relatives=(
  '_shared/lemtelExternalPlatformSigner.ts'
  '_shared/lemtelNodeEnrollment.ts'
  '_shared/lemtelNodeEnrollmentBackend.ts'
  'lemtel-node-enrollment/index.ts'
  'lemtel-node-enrollment/manifest.json'
  'lemtel-node-enrollment-admin/index.ts'
  'lemtel-node-enrollment-admin/manifest.json'
  'lemtel-node-status-signed-ingest/index.ts'
  'lemtel-node-status-signed-ingest/manifest.json'
  'lemtel-onboarding-admin/index.ts'
  'lemtel-onboarding-admin/manifest.json'
)
declare -a target_paths=() backup_paths=() preexisting=() replaced=() temporary=() created_dirs=()
committed=false
migration_result=not_attempted

rollback() {
  local code=$? index target
  trap - EXIT INT TERM
  if [ "$committed" != true ]; then
    for index in "${!target_paths[@]}"; do
      target="${target_paths[$index]}"
      if [ "${replaced[$index]:-false}" = true ]; then
        if [ "${preexisting[$index]:-false}" = true ]; then cp -- "${backup_paths[$index]}" "$target" || true
        else rm -f -- "$target" || true
        fi
      fi
    done
    if [[ " ${replaced[*]:-} " == *' true '* ]]; then
      docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true
      printf 'node_secure_enrollment_sources_rollback=attempted\n' >&2
      printf 'node_secure_enrollment_migration_rollback=not_attempted_additive_migration_remains\n' >&2
    fi
    for ((index=${#created_dirs[@]} - 1; index >= 0; index--)); do rmdir -- "${created_dirs[$index]}" 2>/dev/null || true; done
  fi
  rm -f -- "${temporary[@]:-}" 2>/dev/null || true
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
node_status_state="$(node_status_schema_state || true)"
[ "$node_status_state" = complete ] || fail node_status_0020_not_fully_installed

functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$functions_source" ] && [ -d "$functions_source" ] && [ ! -L "$functions_source" ] || fail runtime_mount_missing

lock_file='/var/lock/lemtel-node-secure-enrollment.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_deploy
install -d -o root -g root -m 0700 "$backup_root"
stage="$(mktemp -d "$backup_root/.package.XXXXXX")"
tar -xf "$archive" -C "$stage" --no-same-owner --no-same-permissions
verify_stage_manifest "$stage"
verify_metadata
verify_source_manifest

# The existing onboarding source must already exist. The shared and three new
# function directories may be created only for the listed paths below.
[ -d "$functions_source/lemtel-onboarding-admin" ] && [ ! -L "$functions_source/lemtel-onboarding-admin" ] || fail onboarding_directory_missing
[ -f "$functions_source/lemtel-onboarding-admin/index.ts" ] && [ ! -L "$functions_source/lemtel-onboarding-admin/index.ts" ] || fail onboarding_target_missing

for index in "${!target_relatives[@]}"; do
  target_paths[$index]="$functions_source/${target_relatives[$index]}"
  parent="$(dirname "${target_paths[$index]}")"
  if [ -e "$parent" ]; then
    [ -d "$parent" ] && [ ! -L "$parent" ] || fail target_directory_invalid
  else
    case "${target_relatives[$index]}" in
      _shared/*|lemtel-node-enrollment/*|lemtel-node-enrollment-admin/*|lemtel-node-status-signed-ingest/*) ;;
      *) fail target_directory_missing ;;
    esac
  fi
  if [ -e "${target_paths[$index]}" ]; then
    [ -f "${target_paths[$index]}" ] && [ ! -L "${target_paths[$index]}" ] || fail target_invalid
    preexisting[$index]=true
  else
    preexisting[$index]=false
  fi
  replaced[$index]=false
done

backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0700 "$backup_dir"
for index in "${!target_paths[@]}"; do
  backup_paths[$index]="$backup_dir/${package_files[$index]}"
  if [ "${preexisting[$index]}" = true ]; then cp --preserve=mode,ownership,timestamps "${target_paths[$index]}" "${backup_paths[$index]}"; fi
done

trap rollback EXIT
trap 'exit 1' INT TERM
apply_enrollment_migration_idempotently

for index in "${!target_paths[@]}"; do
  parent="$(dirname "${target_paths[$index]}")"
  if [ ! -e "$parent" ]; then
    install -d -o root -g root -m 0755 "$parent"
    created_dirs+=("$parent")
  fi
  temporary[$index]="$(mktemp "${target_paths[$index]}.lemtel-node-enrollment.XXXXXX")"
  cp -- "$stage/${package_files[$index]}" "${temporary[$index]}"
  if [ "${preexisting[$index]}" = true ]; then chmod --reference="${target_paths[$index]}" "${temporary[$index]}"; else chmod 0644 "${temporary[$index]}"; fi
  [ "$(sha256sum "${temporary[$index]}" | awk '{print $1}')" = "$(sha256sum "$stage/${package_files[$index]}" | awk '{print $1}')" ] || fail target_stage_digest_mismatch
done

for index in "${!target_paths[@]}"; do
  mv -f -- "${temporary[$index]}" "${target_paths[$index]}"
  temporary[$index]=''
  replaced[$index]=true
done

docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart
for index in "${!target_paths[@]}"; do
  [ "$(sha256sum "${target_paths[$index]}" | awk '{print $1}')" = "$(sha256sum "$stage/${package_files[$index]}" | awk '{print $1}')" ] || fail target_digest_mismatch
done
grep -Fq 'lemtel_node_enrollment' "$functions_source/lemtel-node-enrollment/index.ts" || fail enrollment_function_missing
grep -Fq 'lemtel_node_enrollment' "$functions_source/lemtel-node-enrollment-admin/index.ts" || fail enrollment_admin_function_missing
grep -Fq 'lemtel_record_enrolled_node_status' "$functions_source/lemtel-node-status-signed-ingest/index.ts" || fail signed_ingest_function_missing

committed=true
rm -rf -- "$stage"
stage=''
trap - EXIT INT TERM
printf 'node_secure_enrollment_deploy_format=lemtel_node_secure_enrollment_do_writer_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'snapshot_attestation=verified\n'
printf 'schema_0020=verified_complete_not_applied\n'
printf 'schema_0021=%s\n' "$migration_result"
printf 'edge_sources=replaced\n'
printf 'edge_runtime=restarted_and_running\n'
printf 'secret_configuration_written=false\n'
printf 'publisher_configuration_written=false\n'
printf 'publisher_installed=false\n'
printf 'publisher_timer_enabled=false\n'
printf 'agent_installed=false\n'
printf 'agent_activated=false\n'
printf 'service_activated=false\n'
printf 'timer_activated=false\n'
printf 'standby_runtime_started=false\n'
printf 'caddy_changed=false\n'
printf 'routes_changed=false\n'
printf 'provider_contacted=false\n'
printf 'cloudflare_or_dns_changed=false\n'
printf 'promotion_executed=false\n'
printf 'fencing_executed=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'business_data_read=false\n'
printf 'credential_values_emitted=false\n'
printf 'node_secure_enrollment_deploy_status=complete\n'
