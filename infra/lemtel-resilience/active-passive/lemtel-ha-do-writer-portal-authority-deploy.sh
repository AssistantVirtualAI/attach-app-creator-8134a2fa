#!/usr/bin/env bash
# Root-only, transactional refresh of the Lemtel portal authority on the canonical writer.
# It never controls routing, standby infrastructure, telephony, or provider accounts.
set -euo pipefail

fail() {
  printf 'portal_authority_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_PORTAL_AUTH_EXECUTE:-}" = deploy_verified_portal_authority ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_PORTAL_AUTH_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required

bundle="${LEMTEL_PORTAL_AUTH_BUNDLE:-/home/lemtelops/lemtel-portal-authority-deployment}"
manifest="$bundle/manifest.sha256"
portal_archive="$bundle/portal.tar"
migration="$bundle/0008_lemtel_organization_domains.sql"
function_source="$bundle/lemtel-onboarding-admin.index.ts"
catalog_source="$bundle/lemtelTelephonyReadiness.ts"
backup_root='/var/lib/lemtel-ha/portal-authority/backups'
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
for required in "$manifest" "$portal_archive" "$migration" "$function_source" "$catalog_source"; do [ -s "$required" ] || fail bundle_file_missing; done
for source in "$portal_archive" "$migration" "$function_source" "$catalog_source"; do verify_digest "$source"; done

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
[ -f "$caddyfile" ] || fail caddyfile_missing
[ -f "$function_target" ] && [ -d "$(dirname "$catalog_target")" ] || fail function_target_missing
[ -d "$portal_dir" ] || fail portal_directory_missing
portal_marker_summary="$(awk -v marker="$portal_marker" '
  index($0, marker) { contains += 1 }
  {
    candidate = $0
    sub(/^[[:space:]]+/, "", candidate)
    sub(/[[:space:]]+$/, "", candidate)
    if (candidate == marker) normalized += 1
  }
  END { print (contains + 0) ":" (normalized + 0) }
' "$caddyfile")"
[ "$portal_marker_summary" = '1:1' ] || fail existing_portal_route_required

lock_file='/var/lock/lemtel-portal-authority.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_portal_authority_deploy
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
backup_function="$backup_dir/lemtel-onboarding-admin.index.ts"
backup_catalog="$backup_dir/lemtelTelephonyReadiness.ts"
function_temporary="$(mktemp "${function_target}.lemtel-authority.XXXXXX")"
catalog_temporary="$(mktemp "${catalog_target}.lemtel-authority.XXXXXX")"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-portal-authority-stage.XXXXXX")"
function_replaced=false
catalog_replaced=false
catalog_preexisting=false
portal_replaced=false

rollback() {
  local code=$?
  if [ "$function_replaced" = true ] && [ -f "$backup_function" ]; then
    cp -- "$backup_function" "$function_target"
    if [ "$catalog_replaced" = true ]; then if [ "$catalog_preexisting" = true ]; then cp -- "$backup_catalog" "$catalog_target"; else rm -f "$catalog_target"; fi; fi
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
trap rollback ERR INT TERM

cp --preserve=mode,ownership,timestamps -- "$function_target" "$backup_function"
if [ -f "$catalog_target" ]; then cp --preserve=mode,ownership,timestamps -- "$catalog_target" "$backup_catalog"; catalog_preexisting=true; fi
tar -xf "$portal_archive" -C "$portal_stage"
[ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid

docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
domain_table="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('\''public.lemtel_organization_domains'\'')::text"' 2>/dev/null || true)"
[ "$domain_table" = lemtel_organization_domains ] || fail domain_schema_missing

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
catalog_preexisting=false
portal_replaced=false
trap - ERR INT TERM
printf 'portal_authority_deploy_format=lemtel_portal_authority_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'domain_schema=applied\n'
printf 'onboarding_function=deployed\n'
printf 'portal_bundle=deployed\n'
printf 'dns_change_executed=false\n'
printf 'standby_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'portal_authority_deploy_status=complete\n'
