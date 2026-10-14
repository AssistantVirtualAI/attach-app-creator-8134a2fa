#!/usr/bin/env bash
# Root-only, bounded deployment of Lemtel organization-membership governance to the DO writer.
# It does not change DNS/Cloudflare, start Hostinger, promote/fence a provider, contact telephony,
# create application users, send mail, reveal secrets, or read business data.
set -euo pipefail

fail() {
  printf 'tenant_governance_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_TENANT_GOVERNANCE_EXECUTE:-}" = deploy_verified_tenant_governance ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_TENANT_GOVERNANCE_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required

bundle="${LEMTEL_TENANT_GOVERNANCE_BUNDLE:-/home/lemtelops/lemtel-tenant-governance-deployment}"
manifest="$bundle/manifest.sha256"
metadata="$bundle/deployment-metadata.json"
portal_archive="$bundle/portal.tar"
migration="$bundle/0012_lemtel_membership_governance.sql"
function_source="$bundle/lemtel-onboarding-admin.index.ts"
catalog_source="$bundle/lemtelTelephonyReadiness.ts"
function_manifest="$bundle/lemtel-onboarding-admin.manifest.json"
backup_root='/var/lib/lemtel-ha/tenant-governance/backups'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

verify_digest() {
  local expected actual path
  path="$1"
  expected="$(awk -v file="$(basename "$path")" '$2 == file { print $1 }' "$manifest")"
  [ -n "$expected" ] || fail manifest_entry_missing
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail manifest_digest_mismatch
}

command -v docker >/dev/null 2>&1 || fail docker_missing
docker ps >/dev/null 2>&1 || fail docker_unavailable
for required in "$manifest" "$metadata" "$portal_archive" "$migration" "$function_source" "$catalog_source" "$function_manifest"; do [ -s "$required" ] || fail bundle_file_missing; done
for source in "$metadata" "$portal_archive" "$migration" "$function_source" "$catalog_source" "$function_manifest"; do verify_digest "$source"; done

# The metadata is non-secret and independently pins the source integration revision.
grep -Eq '"scope"[[:space:]]*:[[:space:]]*"lemtel_tenant_membership_governance"' "$metadata" || fail metadata_scope_invalid
grep -Eq '"telephony_provider_contacted"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_telephony_boundary_invalid
grep -Eq '"automatic_failover_enabled"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_failover_boundary_invalid

db_container="$(resolve_database_container || true)"
edge_container='supabase-edge-functions'
caddy_container='supabase-caddy'
[ -n "$db_container" ] || fail database_container_unresolved
for container in "$db_container" "$edge_container" "$caddy_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail writer_not_verified

caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$caddy_source" ] && [ -n "$functions_source" ] || fail runtime_mount_missing
caddyfile="$caddy_source/Caddyfile"
portal_dir="$caddy_source/lemtel-portal"
function_target="$functions_source/lemtel-onboarding-admin/index.ts"
catalog_target="$functions_source/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts"
[ -f "$caddyfile" ] && [ -d "$portal_dir" ] || fail portal_route_or_directory_missing
[ -f "$function_target" ] && [ -f "$catalog_target" ] || fail function_target_missing
portal_marker_summary="$(awk -v marker="$portal_marker" '
  index($0, marker) { contains += 1 }
  { candidate = $0; sub(/^[[:space:]]+/, "", candidate); sub(/[[:space:]]+$/, "", candidate); if (candidate == marker) normalized += 1 }
  END { print (contains + 0) ":" (normalized + 0) }
' "$caddyfile")"
[ "$portal_marker_summary" = '1:1' ] || fail portal_route_missing_or_ambiguous

lock_file='/var/lock/lemtel-tenant-governance.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_tenant_governance_deploy
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
backup_function="$backup_dir/lemtel-onboarding-admin.index.ts"
backup_catalog="$backup_dir/lemtelTelephonyReadiness.ts"
function_temporary="$(mktemp "${function_target}.lemtel-governance.XXXXXX")"
catalog_temporary="$(mktemp "${catalog_target}.lemtel-governance.XXXXXX")"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-tenant-governance-stage.XXXXXX")"
function_replaced=false
catalog_replaced=false
portal_replaced=false

rollback_files() {
  local code=$?
  if [ "$function_replaced" = true ] && [ -f "$backup_function" ]; then
    cp -- "$backup_function" "$function_target"
    if [ "$catalog_replaced" = true ] && [ -f "$backup_catalog" ]; then cp -- "$backup_catalog" "$catalog_target"; fi
    docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true
  fi
  if [ "$portal_replaced" = true ]; then
    rm -rf "$portal_dir"
    [ -d "$backup_dir/lemtel-portal" ] && mv "$backup_dir/lemtel-portal" "$portal_dir" || true
  fi
  rm -f "$function_temporary" "$catalog_temporary"
  [ -d "$portal_stage" ] && rm -rf "$portal_stage" || true
  exit "$code"
}
trap rollback_files ERR INT TERM

cp --preserve=mode,ownership,timestamps -- "$function_target" "$backup_function"
cp --preserve=mode,ownership,timestamps -- "$catalog_target" "$backup_catalog"
tar -xf "$portal_archive" -C "$portal_stage"
[ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid

# This migration is bounded DDL only; it never reads or writes business records.
docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
audit_action_constraint="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '\''lemtel_onboarding_audit_action_check'\''"' 2>/dev/null || true)"
printf '%s' "$audit_action_constraint" | grep -Fq 'membership_assigned' || fail membership_audit_constraint_missing
printf '%s' "$audit_action_constraint" | grep -Fq 'membership_reactivated' || fail membership_audit_constraint_missing
printf '%s' "$audit_action_constraint" | grep -Fq 'membership_role_changed' || fail membership_audit_constraint_missing
authority_trigger_count="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_trigger WHERE tgname = '\''lemtel_membership_authority_revision_after_change'\'' AND NOT tgisinternal"' 2>/dev/null || true)"
[ "$authority_trigger_count" = 1 ] || fail authority_revision_trigger_missing

cp -- "$function_source" "$function_temporary"
cp -- "$catalog_source" "$catalog_temporary"
chmod --reference="$function_target" "$function_temporary" "$catalog_temporary"
function_replaced=true
mv -f "$function_temporary" "$function_target"
mv -f "$catalog_temporary" "$catalog_target"
catalog_replaced=true
docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart

mv "$portal_dir" "$backup_dir/lemtel-portal"
mv "$portal_stage" "$portal_dir"
portal_replaced=true
[ -s "$portal_dir/lemtel-portal.html" ] || fail portal_install_invalid

function_replaced=false
catalog_replaced=false
portal_replaced=false
trap - ERR INT TERM
printf 'tenant_governance_deploy_format=lemtel_tenant_governance_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'membership_audit_schema=applied\n'
printf 'account_authority_revision_trigger=verified\n'
printf 'portal_bundle=deployed\n'
printf 'edge_function=deployed\n'
printf 'database_business_data_mutation=false\n'
printf 'dns_change_executed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_provider_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'tenant_governance_deploy_status=complete\n'
