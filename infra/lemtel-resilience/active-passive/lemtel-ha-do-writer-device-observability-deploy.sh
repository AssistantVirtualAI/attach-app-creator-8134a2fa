#!/usr/bin/env bash
# Root-only transactional install of the verified Lemtel admin portal, presence and Operations trend.
# No Cloudflare, DNS, Hostinger runtime, promotion, fencing, public database listener or telephony action.
set -euo pipefail

fail() {
  printf 'device_observability_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_DEVICE_OBSERVABILITY_EXECUTE:-}" = 'deploy_verified_writer_observability' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail writer_role_required
[ "${LEMTEL_PORTAL_AUTH_BACKUP_ATTESTATION:-}" = 'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED' ] || fail fresh_backup_attestation_required

bundle="${LEMTEL_DEVICE_OBSERVABILITY_BUNDLE:-/home/lemtelops/lemtel-device-observability-deployment}"
manifest="$bundle/manifest.sha256"
portal_archive="$bundle/portal.tar"
backup_root='/var/lib/lemtel-ha/device-observability/backups'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'

required_files=(
  "$portal_archive"
  "$bundle/0008_lemtel_organization_domains.sql"
  "$bundle/0010_lemtel_client_connections.sql"
  "$bundle/0011_lemtel_operational_status_history.sql"
  "$bundle/lemtel-onboarding-admin.index.ts"
  "$bundle/lemtel-session-bootstrap.index.ts"
  "$bundle/lemtel-ha-promoted-writer-status-publish.sh"
  "$bundle/lemtel-ha-promoted-writer-status-timer-enable.sh"
)

verify_digest() {
  local path="$1" expected actual
  expected="$(awk -v file="$(basename "$path")" '$2 == file { print $1 }' "$manifest")"
  [ -n "$expected" ] || fail manifest_entry_missing
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail manifest_digest_mismatch
}

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

command -v docker >/dev/null 2>&1 || fail docker_missing
[ -s "$manifest" ] || fail manifest_missing
for path in "${required_files[@]}"; do [ -s "$path" ] || fail bundle_file_missing; verify_digest "$path"; done

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
admin_target="$functions_source/lemtel-onboarding-admin/index.ts"
session_target="$functions_source/lemtel-session-bootstrap/index.ts"
[ -f "$caddyfile" ] && [ -d "$portal_dir" ] && [ -f "$admin_target" ] && [ -f "$session_target" ] || fail runtime_target_missing
marker_summary="$(awk -v marker="$portal_marker" '
  index($0, marker) { contains += 1 }
  { candidate = $0; sub(/^[[:space:]]+/, "", candidate); sub(/[[:space:]]+$/, "", candidate); if (candidate == marker) normalized += 1 }
  END { print (contains + 0) ":" (normalized + 0) }
' "$caddyfile")"
[ "$marker_summary" = '1:1' ] || fail existing_portal_route_required

lock_file='/var/lock/lemtel-device-observability.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_deploy
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
cp --preserve=mode,ownership,timestamps "$admin_target" "$backup_dir/lemtel-onboarding-admin.index.ts"
cp --preserve=mode,ownership,timestamps "$session_target" "$backup_dir/lemtel-session-bootstrap.index.ts"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-device-observability-stage.XXXXXX")"
admin_temp="$(mktemp "${admin_target}.lemtel-device.XXXXXX")"
session_temp="$(mktemp "${session_target}.lemtel-device.XXXXXX")"
portal_replaced=false
functions_replaced=false

rollback() {
  local code=$?
  if [ "$functions_replaced" = true ]; then
    cp -- "$backup_dir/lemtel-onboarding-admin.index.ts" "$admin_target" || true
    cp -- "$backup_dir/lemtel-session-bootstrap.index.ts" "$session_target" || true
    docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true
  fi
  if [ "$portal_replaced" = true ]; then
    rm -rf "$portal_dir" || true
    [ -d "$backup_dir/lemtel-portal" ] && mv "$backup_dir/lemtel-portal" "$portal_dir" || true
  fi
  rm -f "$admin_temp" "$session_temp"
  [ -d "$portal_stage" ] && rm -rf "$portal_stage" || true
  exit "$code"
}
trap rollback ERR INT TERM

tar -xf "$portal_archive" -C "$portal_stage"
[ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid

docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$bundle/0008_lemtel_organization_domains.sql"
docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$bundle/0010_lemtel_client_connections.sql"
docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$bundle/0011_lemtel_operational_status_history.sql"
for object in public.lemtel_organization_domains public.lemtel_client_connection_presence public.lemtel_operational_status_history; do
  present="$(docker exec "$db_container" sh -eu -c "export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT to_regclass('$object')::text\"" 2>/dev/null || true)"
  [ "${present#public.}" = "${object#public.}" ] || fail schema_object_missing
done

cp -- "$bundle/lemtel-onboarding-admin.index.ts" "$admin_temp"
cp -- "$bundle/lemtel-session-bootstrap.index.ts" "$session_temp"
chmod --reference="$admin_target" "$admin_temp"
chmod --reference="$session_target" "$session_temp"
mv -f "$admin_temp" "$admin_target"
mv -f "$session_temp" "$session_target"
functions_replaced=true
docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart

mv "$portal_dir" "$backup_dir/lemtel-portal"
mv "$portal_stage" "$portal_dir"
portal_replaced=true
[ -s "$portal_dir/lemtel-portal.html" ] || fail portal_install_invalid

chmod 0700 "$bundle/lemtel-ha-promoted-writer-status-publish.sh" "$bundle/lemtel-ha-promoted-writer-status-timer-enable.sh"
LEMTEL_HA_EXECUTE=enable_redacted_promoted_writer_status_timer \
LEMTEL_HA_ROLE=digitalocean_promoted_writer \
LEMTEL_HA_STATUS_PUBLISHER_PATH="$bundle/lemtel-ha-promoted-writer-status-publish.sh" \
  bash "$bundle/lemtel-ha-promoted-writer-status-timer-enable.sh"
[ "$(systemctl is-active lemtel-ha-promoted-writer-status.timer)" = active ] || fail operations_status_timer_inactive

functions_replaced=false
portal_replaced=false
trap - ERR INT TERM
printf 'device_observability_deploy_format=lemtel_device_observability_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'domain_schema=applied\n'
printf 'client_connection_schema=applied\n'
printf 'operational_history_schema=applied\n'
printf 'portal_bundle=deployed\n'
printf 'edge_functions=deployed\n'
printf 'operations_status_timer_active=active\n'
printf 'database_business_data_mutation=false\n'
printf 'dns_change_executed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'device_observability_deploy_status=complete\n'
