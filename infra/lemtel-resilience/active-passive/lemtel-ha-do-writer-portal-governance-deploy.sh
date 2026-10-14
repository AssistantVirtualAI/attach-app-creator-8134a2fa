#!/usr/bin/env bash
# Root-only, transactional deployment of approved Lemtel portal governance on the DO writer.
# It applies Lemtel-only schema, refreshes portal/Edge source, and never changes DNS/Cloudflare,
# PostgreSQL networking, Hostinger runtime, promotion/fencing, providers, or telephony.
set -euo pipefail

fail() { printf 'portal_governance_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_PORTAL_GOVERNANCE_EXECUTE:-}" = deploy_verified_portal_governance ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_PORTAL_GOVERNANCE_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required

bundle="${LEMTEL_PORTAL_GOVERNANCE_BUNDLE:-/home/lemtelops/lemtel-portal-governance-deployment}"
manifest="$bundle/manifest.sha256"
metadata="$bundle/deployment-metadata.json"
portal_archive="$bundle/portal.tar"
admin_source="$bundle/lemtel-onboarding-admin.index.ts"
bootstrap_source="$bundle/lemtel-session-bootstrap.index.ts"
catalog_source="$bundle/lemtelTelephonyReadiness.ts"
admin_manifest="$bundle/lemtel-onboarding-admin.manifest.json"
bootstrap_manifest="$bundle/lemtel-session-bootstrap.manifest.json"
migrations=("$bundle/0012_lemtel_membership_governance.sql" "$bundle/0013_lemtel_organization_ownership_transfer.sql" "$bundle/0014_lemtel_client_session_controls.sql")
backup_root='/var/lib/lemtel-ha/portal-governance/backups'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
verify_digest() {
  local expected actual path
  path="$1"; expected="$(awk -v file="$(basename "$path")" '$2 == file { print $1 }' "$manifest")"
  [ -n "$expected" ] || fail manifest_entry_missing
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail manifest_digest_mismatch
}
command -v docker >/dev/null 2>&1 || fail docker_missing
docker ps >/dev/null 2>&1 || fail docker_unavailable
for required in "$manifest" "$metadata" "$portal_archive" "$admin_source" "$bootstrap_source" "$catalog_source" "$admin_manifest" "$bootstrap_manifest" "${migrations[@]}"; do [ -s "$required" ] || fail bundle_file_missing; done
for source in "$metadata" "$portal_archive" "$admin_source" "$bootstrap_source" "$catalog_source" "$admin_manifest" "$bootstrap_manifest" "${migrations[@]}"; do verify_digest "$source"; done
grep -Eq '"scope"[[:space:]]*:[[:space:]]*"lemtel_portal_governance"' "$metadata" || fail metadata_scope_invalid
grep -Eq '"telephony_provider_contacted"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_telephony_boundary_invalid
grep -Eq '"automatic_failover_enabled"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_failover_boundary_invalid

db_container="$(resolve_database_container || true)"; edge_container='supabase-edge-functions'; caddy_container='supabase-caddy'
[ -n "$db_container" ] || fail database_container_unresolved
for container in "$db_container" "$edge_container" "$caddy_container"; do docker inspect "$container" >/dev/null 2>&1 || fail container_missing; [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running; done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail writer_not_verified
caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$caddy_source" ] && [ -n "$functions_source" ] || fail runtime_mount_missing
caddyfile="$caddy_source/Caddyfile"; portal_dir="$caddy_source/lemtel-portal"
admin_target="$functions_source/lemtel-onboarding-admin/index.ts"; catalog_target="$functions_source/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts"; bootstrap_target="$functions_source/lemtel-session-bootstrap/index.ts"
[ -f "$caddyfile" ] && [ -d "$portal_dir" ] || fail portal_route_or_directory_missing
[ -f "$admin_target" ] && [ -f "$catalog_target" ] && [ -f "$bootstrap_target" ] || fail function_target_missing
portal_marker_summary="$(awk -v marker="$portal_marker" 'index($0, marker) { contains += 1 } { candidate = $0; sub(/^[[:space:]]+/, "", candidate); sub(/[[:space:]]+$/, "", candidate); if (candidate == marker) normalized += 1 } END { print (contains + 0) ":" (normalized + 0) }' "$caddyfile")"
[ "$portal_marker_summary" = '1:1' ] || fail portal_route_missing_or_ambiguous

exec 9> /var/lock/lemtel-portal-governance.lock
flock -n 9 || fail concurrent_portal_governance_deploy
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"; install -d -o root -g root -m 0700 "$backup_dir"
admin_backup="$backup_dir/lemtel-onboarding-admin.index.ts"; catalog_backup="$backup_dir/lemtelTelephonyReadiness.ts"; bootstrap_backup="$backup_dir/lemtel-session-bootstrap.index.ts"
admin_tmp="$(mktemp "${admin_target}.lemtel-governance.XXXXXX")"; catalog_tmp="$(mktemp "${catalog_target}.lemtel-governance.XXXXXX")"; bootstrap_tmp="$(mktemp "${bootstrap_target}.lemtel-governance.XXXXXX")"; portal_stage="$(mktemp -d "${caddy_source}/.lemtel-portal-governance-stage.XXXXXX")"
admin_replaced=false; catalog_replaced=false; bootstrap_replaced=false; portal_replaced=false
rollback() {
  local code=$?
  if [ "$admin_replaced" = true ] && [ -f "$admin_backup" ]; then cp -- "$admin_backup" "$admin_target"; [ "$catalog_replaced" = true ] && cp -- "$catalog_backup" "$catalog_target" || true; [ "$bootstrap_replaced" = true ] && cp -- "$bootstrap_backup" "$bootstrap_target" || true; docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true; fi
  if [ "$portal_replaced" = true ]; then rm -rf "$portal_dir"; [ -d "$backup_dir/lemtel-portal" ] && mv "$backup_dir/lemtel-portal" "$portal_dir" || true; fi
  rm -f "$admin_tmp" "$catalog_tmp" "$bootstrap_tmp"; [ -d "$portal_stage" ] && rm -rf "$portal_stage" || true; exit "$code"
}
trap rollback ERR INT TERM
cp --preserve=mode,ownership,timestamps -- "$admin_target" "$admin_backup"; cp --preserve=mode,ownership,timestamps -- "$catalog_target" "$catalog_backup"; cp --preserve=mode,ownership,timestamps -- "$bootstrap_target" "$bootstrap_backup"
tar -xf "$portal_archive" -C "$portal_stage"; [ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid
for migration in "${migrations[@]}"; do docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"; done
schema_checks="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('\''public.lemtel_organization_memberships'\'')::text || '\''|\'' || to_regclass('\''public.lemtel_client_session_controls'\'')::text || '\''|\'' || count(*)::text FROM pg_proc WHERE proname IN ('\''lemtel_transfer_organization_ownership'\'', '\''lemtel_session_bootstrap_context_for_client'\'', '\''lemtel_record_authorized_client_connection'\'')"' 2>/dev/null || true)"
printf '%s' "$schema_checks" | grep -Eq '^lemtel_organization_memberships\|lemtel_client_session_controls\|3$' || fail governance_schema_verification_failed
cp -- "$admin_source" "$admin_tmp"; cp -- "$catalog_source" "$catalog_tmp"; cp -- "$bootstrap_source" "$bootstrap_tmp"; chmod --reference="$admin_target" "$admin_tmp" "$catalog_tmp" "$bootstrap_tmp"
admin_replaced=true; mv -f "$admin_tmp" "$admin_target"; catalog_replaced=true; mv -f "$catalog_tmp" "$catalog_target"; bootstrap_replaced=true; mv -f "$bootstrap_tmp" "$bootstrap_target"
docker restart --time 30 "$edge_container" >/dev/null; [ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart
mv "$portal_dir" "$backup_dir/lemtel-portal"; mv "$portal_stage" "$portal_dir"; portal_replaced=true; [ -s "$portal_dir/lemtel-portal.html" ] || fail portal_install_invalid
admin_replaced=false; catalog_replaced=false; bootstrap_replaced=false; portal_replaced=false; trap - ERR INT TERM
printf 'portal_governance_deploy_format=lemtel_portal_governance_deploy_v1\nwriter=digitalocean_writer\nmembership_domain_ownership_session_schema=applied\nportal_bundle=deployed\nedge_authority_and_bootstrap=deployed\ndatabase_business_data_mutation=false\ndns_change_executed=false\nhostinger_runtime_started=false\nautomatic_promotion_enabled=false\nautomatic_traffic_failover_enabled=false\nfencing_executed=false\ntelephony_provider_contacted=false\ncredential_values_emitted=false\nportal_governance_deploy_status=complete\n'
