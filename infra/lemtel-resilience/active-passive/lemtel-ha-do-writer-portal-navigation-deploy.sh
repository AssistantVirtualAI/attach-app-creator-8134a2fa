#!/usr/bin/env bash
# Root-only, transactional static portal refresh for Lemtel telephony navigation.
# It never changes database data/schema, Edge Functions, network routing, standby, fencing, or telephony providers.
set -euo pipefail
fail() { printf 'portal_navigation_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_PORTAL_NAVIGATION_EXECUTE:-}" = deploy_verified_portal_navigation ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_PORTAL_NAVIGATION_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required
bundle="${LEMTEL_PORTAL_NAVIGATION_BUNDLE:-/home/lemtelops/lemtel-portal-navigation-deployment}"
manifest="$bundle/manifest.sha256"
metadata="$bundle/deployment-metadata.json"
portal_archive="$bundle/portal.tar"
backup_root='/var/lib/lemtel-ha/portal-navigation/backups'
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
for required in "$manifest" "$metadata" "$portal_archive"; do [ -s "$required" ] || fail bundle_file_missing; done
verify_digest "$metadata"
verify_digest "$portal_archive"
grep -Eq '"scope"[[:space:]]*:[[:space:]]*"lemtel_portal_navigation"' "$metadata" || fail metadata_scope_invalid
grep -Eq '"database_mutation"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_database_boundary_invalid
grep -Eq '"telephony_provider_contacted"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_telephony_boundary_invalid
grep -Eq '"automatic_failover_enabled"[[:space:]]*:[[:space:]]*false' "$metadata" || fail metadata_failover_boundary_invalid
db_container="$(resolve_database_container || true)"
caddy_container='supabase-caddy'
[ -n "$db_container" ] || fail database_container_unresolved
for container in "$db_container" "$caddy_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail writer_not_verified
caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
[ -n "$caddy_source" ] || fail caddy_mount_missing
caddyfile="$caddy_source/Caddyfile"
portal_dir="$caddy_source/lemtel-portal"
[ -f "$caddyfile" ] && [ -d "$portal_dir" ] || fail portal_route_or_directory_missing
portal_marker_summary="$(awk -v marker="$portal_marker" 'index($0, marker) { contains += 1 } { candidate = $0; sub(/^[[:space:]]+/, "", candidate); sub(/[[:space:]]+$/, "", candidate); if (candidate == marker) normalized += 1 } END { print (contains + 0) ":" (normalized + 0) }' "$caddyfile")"
[ "$portal_marker_summary" = '1:1' ] || fail portal_route_missing_or_ambiguous
exec 9> /var/lock/lemtel-portal-navigation.lock
flock -n 9 || fail concurrent_portal_navigation_deploy
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-portal-navigation-stage.XXXXXX")"
portal_replaced=false
rollback() {
  local code=$?
  if [ "$portal_replaced" = true ]; then
    rm -rf "$portal_dir"
    [ -d "$backup_dir/lemtel-portal" ] && mv "$backup_dir/lemtel-portal" "$portal_dir" || true
  fi
  [ -d "$portal_stage" ] && rm -rf "$portal_stage" || true
  exit "$code"
}
trap rollback ERR INT TERM
tar -xf "$portal_archive" -C "$portal_stage"
[ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid
[ -d "$portal_stage/assets" ] || fail portal_assets_missing
if find "$portal_stage" -type f \( -name '*.map' -o -name '.env' \) | grep -q .; then fail portal_archive_unexpected_file; fi
mv "$portal_dir" "$backup_dir/lemtel-portal"
mv "$portal_stage" "$portal_dir"
portal_replaced=true
[ -s "$portal_dir/lemtel-portal.html" ] || fail portal_install_invalid
[ -d "$portal_dir/assets" ] || fail portal_assets_missing_after_install
portal_replaced=false
trap - ERR INT TERM
printf 'portal_navigation_deploy_format=lemtel_portal_navigation_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'portal_bundle=deployed\n'
printf 'database_mutation=false\n'
printf 'edge_function_changed=false\n'
printf 'dns_change_executed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_provider_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'portal_navigation_deploy_status=complete\n'
