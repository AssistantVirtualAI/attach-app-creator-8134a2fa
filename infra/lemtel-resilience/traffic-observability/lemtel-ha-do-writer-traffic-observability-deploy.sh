#!/usr/bin/env bash
# Root-only, transactional deployment of the inactive Lemtel traffic observability plane on DO writer.
# This script NEVER enables collectors, configures JWT bypass, writes secrets, changes traffic routing or changes HA state.
# The separate ingress-route and collector phases retain their own access-log attestation gate.
set -euo pipefail
fail() { printf 'traffic_observability_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_TRAFFIC_DEPLOY_EXECUTE:-}" = deploy_verified_traffic_observability ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_TRAFFIC_DEPLOY_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required
[ "${LEMTEL_TRAFFIC_DEPLOY_REVIEW_APPROVAL:-}" = REVIEWED_DO_WRITER_TRAFFIC_DEPLOY ] || fail review_approval_required
[ "${LEMTEL_TRAFFIC_DEPLOY_SNAPSHOT_ATTESTATION:-}" = DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED ] || fail snapshot_restore_attestation_required
bundle="${LEMTEL_TRAFFIC_DEPLOY_BUNDLE:-/home/lemtelops/lemtel-traffic-observability-deployment}"
manifest="$bundle/manifest.sha256"
metadata="$bundle/deployment-metadata.json"
migration="$bundle/0017_lemtel_traffic_samples.sql"
portal_archive="$bundle/portal.tar"
admin_source="$bundle/lemtel-onboarding-admin.index.ts"
admin_manifest="$bundle/lemtel-onboarding-admin.manifest.json"
ingest_source="$bundle/lemtel-traffic-ingest.index.ts"
ingest_manifest="$bundle/lemtel-traffic-ingest.manifest.json"
backup_root='/var/lib/lemtel-ha/traffic-observability/backups'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'
resolve_database_container() { local -a c=(); mapfile -t c < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ {print $1}'); [ "${#c[@]}" -eq 1 ] && printf '%s' "${c[0]}"; }
verify_digest() { local path="$1" expected actual; expected="$(awk -v f="$(basename "$path")" '$2 == f {print $1}' "$manifest")"; [ -n "$expected" ] || fail manifest_entry_missing; actual="$(sha256sum "$path" | awk '{print $1}')"; [ "$expected" = "$actual" ] || fail manifest_digest_mismatch; }
command -v docker >/dev/null 2>&1 || fail docker_missing
docker ps >/dev/null 2>&1 || fail docker_unavailable
for required in "$manifest" "$metadata" "$migration" "$portal_archive" "$admin_source" "$admin_manifest" "$ingest_source" "$ingest_manifest"; do [ -s "$required" ] || fail bundle_file_missing; done
for source in "$metadata" "$migration" "$portal_archive" "$admin_source" "$admin_manifest" "$ingest_source" "$ingest_manifest"; do verify_digest "$source"; done
grep -Eq '"scope"[[:space:]]*:[[:space:]]*"lemtel_traffic_observability"' "$metadata" || fail metadata_scope_invalid
grep -Eq '"database_mutation"[[:space:]]*:[[:space:]]*true' "$metadata" || fail metadata_database_boundary_invalid
grep -Eq '"collector_activation"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_collector_boundary_invalid
grep -Eq '"gateway_route_changed"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_gateway_boundary_invalid
grep -Eq '"automatic_failover_enabled"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_failover_boundary_invalid
db="$(resolve_database_container || true)"; edge='supabase-edge-functions'; caddy='supabase-caddy'
[ -n "$db" ] || fail database_container_unresolved
for c in "$db" "$edge" "$caddy"; do docker inspect "$c" >/dev/null 2>&1 || fail container_missing; [ "$(docker inspect --format '{{.State.Running}}' "$c")" = true ] || fail container_not_running; done
writer_state="$(docker exec "$db" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"; [ "$writer_state" = false ] || fail writer_not_verified
caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy")"
functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge")"
[ -n "$caddy_source" ] && [ -n "$functions_source" ] || fail runtime_mount_missing
portal_dir="$caddy_source/lemtel-portal"; caddyfile="$caddy_source/Caddyfile"; admin_target="$functions_source/lemtel-onboarding-admin/index.ts"; admin_manifest_target="$functions_source/lemtel-onboarding-admin/manifest.json"; ingest_dir="$functions_source/lemtel-traffic-ingest"; ingest_target="$ingest_dir/index.ts"; ingest_manifest_target="$ingest_dir/manifest.json"
[ -f "$caddyfile" ] && [ -d "$portal_dir" ] && [ -f "$admin_target" ] || fail runtime_target_missing
admin_manifest_runtime=false
if [ -e "$admin_manifest_target" ] && [ ! -f "$admin_manifest_target" ]; then fail admin_manifest_target_invalid; elif [ -f "$admin_manifest_target" ]; then admin_manifest_runtime=true; fi
marker="$(awk -v m="$portal_marker" 'index($0,m){all++}{x=$0;sub(/^[[:space:]]+/,"",x);sub(/[[:space:]]+$/,"",x);if(x==m) exact++}END{print (all+0)":"(exact+0)}' "$caddyfile")"; [ "$marker" = '1:1' ] || fail portal_route_missing_or_ambiguous
schema="$(docker exec "$db" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT CASE WHEN to_regclass('"'"'public.lemtel_traffic_samples'"'"') IS NULL THEN '"'"'missing'"'"' ELSE '"'"'present'"'"' END"' 2>/dev/null || true)"
if [ "$schema" = missing ]; then docker exec -i "$db" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"; elif [ "$schema" != present ]; then fail traffic_schema_query_failed; fi
schema="$(docker exec "$db" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT CASE WHEN to_regclass('"'"'public.lemtel_traffic_samples'"'"') IS NOT NULL AND to_regprocedure('"'"'public.lemtel_traffic_retention()'"'"') IS NOT NULL THEN '"'"'present'"'"' ELSE '"'"'missing'"'"' END"' 2>/dev/null || true)"; [ "$schema" = present ] || fail traffic_schema_verification_failed
exec 9> /var/lock/lemtel-traffic-observability-deploy.lock; flock -n 9 || fail concurrent_deploy
install -d -o root -g root -m 0700 "$backup_root"; backup="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"; install -d -o root -g root -m 0700 "$backup"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-traffic-portal.XXXXXX")"; admin_tmp="$(mktemp "${admin_target}.traffic.XXXXXX")"; admin_manifest_tmp=''; if [ "$admin_manifest_runtime" = true ]; then admin_manifest_tmp="$(mktemp "${admin_manifest_target}.traffic.XXXXXX")"; fi; ingest_stage="$(mktemp -d "${functions_source}/.lemtel-traffic-ingest.XXXXXX")"
admin_changed=false; admin_manifest_changed=false; portal_changed=false; ingest_changed=false
rollback() { code=$?; if [ "$admin_changed" = true ]; then cp -- "$backup/admin-index.ts" "$admin_target" || true; [ "$admin_manifest_changed" = true ] && cp -- "$backup/admin-manifest.json" "$admin_manifest_target" || true; [ "$ingest_changed" = true ] && rm -rf "$ingest_dir" && [ -d "$backup/lemtel-traffic-ingest" ] && mv "$backup/lemtel-traffic-ingest" "$ingest_dir" || true; docker restart --time 30 "$edge" >/dev/null 2>&1 || true; fi; if [ "$portal_changed" = true ]; then rm -rf "$portal_dir"; [ -d "$backup/lemtel-portal" ] && mv "$backup/lemtel-portal" "$portal_dir" || true; fi; rm -f "$admin_tmp"; [ -n "$admin_manifest_tmp" ] && rm -f "$admin_manifest_tmp" || true; rm -rf "$portal_stage" "$ingest_stage"; exit "$code"; }
trap rollback ERR INT TERM
cp --preserve=mode,ownership,timestamps "$admin_target" "$backup/admin-index.ts"; if [ "$admin_manifest_runtime" = true ]; then cp --preserve=mode,ownership,timestamps "$admin_manifest_target" "$backup/admin-manifest.json"; fi; [ -d "$ingest_dir" ] && cp -a "$ingest_dir" "$backup/lemtel-traffic-ingest" || true
tar -xf "$portal_archive" -C "$portal_stage"; [ -s "$portal_stage/lemtel-portal.html" ] && [ -d "$portal_stage/assets" ] || fail portal_archive_invalid
if find "$portal_stage" -type f \( -name '*.map' -o -name '.env' \) | grep -q .; then fail portal_archive_unexpected_file; fi
cp -- "$admin_source" "$admin_tmp"; chmod --reference="$admin_target" "$admin_tmp"; if [ "$admin_manifest_runtime" = true ]; then cp -- "$admin_manifest" "$admin_manifest_tmp"; chmod --reference="$admin_manifest_target" "$admin_manifest_tmp"; fi; install -d -o root -g root -m 0750 "$ingest_stage"; install -o root -g root -m 0640 "$ingest_source" "$ingest_stage/index.ts"; install -o root -g root -m 0640 "$ingest_manifest" "$ingest_stage/manifest.json"
admin_changed=true; mv -f "$admin_tmp" "$admin_target"; if [ "$admin_manifest_runtime" = true ]; then admin_manifest_changed=true; mv -f "$admin_manifest_tmp" "$admin_manifest_target"; fi; [ -d "$ingest_dir" ] && rm -rf "$ingest_dir"; mv "$ingest_stage" "$ingest_dir"; ingest_changed=true
docker restart --time 30 "$edge" >/dev/null; [ "$(docker inspect --format '{{.State.Running}}' "$edge")" = true ] || fail edge_runtime_not_running_after_restart
mv "$portal_dir" "$backup/lemtel-portal"; portal_changed=true; mv "$portal_stage" "$portal_dir"; [ -s "$portal_dir/lemtel-portal.html" ] && [ -d "$portal_dir/assets" ] || fail portal_install_invalid
admin_changed=false; admin_manifest_changed=false; ingest_changed=false; portal_changed=false; trap - ERR INT TERM
printf 'traffic_observability_deploy_format=lemtel_traffic_observability_deploy_v1\nwriter=digitalocean_writer\ntraffic_schema=applied_or_verified\nportal_bundle=deployed\nedge_traffic_ingress_source=deployed\nedge_admin_manifest_runtime=%s\nedge_route_specific_jwt_bypass_configured=false\ntraffic_collectors_enabled=false\ndatabase_business_data_mutation=false\ndns_change_executed=false\nhostinger_runtime_started=false\nautomatic_promotion_enabled=false\nautomatic_traffic_failover_enabled=false\nfencing_executed=false\ntelephony_provider_contacted=false\ncredential_values_emitted=false\ntraffic_observability_deploy_status=complete\n' "$admin_manifest_runtime"
