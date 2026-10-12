#!/usr/bin/env bash
# Root-only, transactional deployment of the isolated Lemtel Operations portal on the promoted DO writer.
# Hostinger, DNS/Cloudflare, database networking, failover/failback, payments and telephony are out of scope.
set -euo pipefail

fail() {
  printf 'operations_portal_deploy_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_OPS_EXECUTE:-}" = 'deploy_verified_operations_portal' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role
[ "${LEMTEL_OPS_BACKUP_ATTESTATION:-}" = 'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED' ] || fail fresh_encrypted_backup_attestation_required

bundle="${LEMTEL_OPERATIONS_PORTAL_BUNDLE:-/home/lemtelops/lemtel-operations-deployment}"
manifest="$bundle/manifest.sha256"
portal_archive="$bundle/portal.tar"
migration="$bundle/0006_lemtel_operational_status.sql"
function_source="$bundle/lemtel-onboarding-admin.index.ts"
publisher_source="$bundle/lemtel-ha-promoted-writer-status-publish.sh"
timer_source="$bundle/lemtel-ha-promoted-writer-status-timer-enable.sh"
resolve_database_container() {
  local -a candidates=()
  # Match PostgreSQL itself, never the distinct postgres-meta sidecar.
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

db_container="$(resolve_database_container || true)"
[ -n "$db_container" ] || fail database_container_unresolved
caddy_container='supabase-caddy'
edge_container='supabase-edge-functions'
canonical_host='lemtel.assistantvirtualai.com'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'
backup_root='/var/lib/lemtel-ha/operations-portal/backups'

for required in "$manifest" "$migration" "$function_source" "$publisher_source" "$timer_source"; do
  [ -s "$required" ] || fail "bundle_file_missing"
done
[ -s "$portal_archive" ] || fail portal_artifact_missing

verify_digest() {
  local expected path actual
  path="$1"
  expected="$(awk -v file="$(basename "$path")" '$2 == file { print $1 }' "$manifest")"
  [ -n "$expected" ] || fail manifest_entry_missing
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail manifest_digest_mismatch
}
for source in "$migration" "$function_source" "$publisher_source" "$timer_source" "$portal_archive"; do verify_digest "$source"; done

for container in "$db_container" "$caddy_container" "$edge_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail digitalocean_writer_not_verified

caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$caddy_source" ] && [ -n "$functions_source" ] || fail required_runtime_mount_missing
caddyfile="$caddy_source/Caddyfile"
function_target="$functions_source/lemtel-onboarding-admin/index.ts"
[ -f "$caddyfile" ] || fail caddyfile_missing
[ -f "$function_target" ] || fail onboarding_function_missing
[ "$(grep -Fxc "{\$PROXY_DOMAIN}, $canonical_host {" "$caddyfile" || true)" = 1 ] || fail canonical_caddy_site_unexpected
! grep -Fq "$portal_marker" "$caddyfile" || fail portal_route_already_present

lock_file='/var/lock/lemtel-operations-portal.lock'
exec 9>"$lock_file"
flock -n 9 || fail concurrent_operations_portal_deploy

install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
backup_caddy="$backup_dir/Caddyfile"
backup_function="$backup_dir/lemtel-onboarding-admin.index.ts"
portal_dir="$caddy_source/lemtel-portal"
caddy_candidate="$(mktemp "${caddyfile}.lemtel-operations.XXXXXX")"
caddy_temporary="$(mktemp "${caddyfile}.lemtel-live.XXXXXX")"
function_temporary="$(mktemp "${function_target}.lemtel-live.XXXXXX")"
portal_stage="$(mktemp -d "${caddy_source}/.lemtel-portal-stage.XXXXXX")"
caddy_replaced=false
function_replaced=false
portal_replaced=false
timer_enabled=false

rollback() {
  local code=$?
  if [ "$timer_enabled" = true ]; then
    systemctl disable --now lemtel-ha-promoted-writer-status.timer >/dev/null 2>&1 || true
  fi
  if [ "$caddy_replaced" = true ] && [ -f "$backup_caddy" ]; then
    cp -- "$backup_caddy" "$caddyfile"
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  fi
  if [ "$function_replaced" = true ] && [ -f "$backup_function" ]; then
    cp -- "$backup_function" "$function_target"
    docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true
  fi
  if [ "$portal_replaced" = true ]; then
    rm -rf "$portal_dir"
    [ -d "$backup_dir/lemtel-portal" ] && mv "$backup_dir/lemtel-portal" "$portal_dir" || true
  fi
  rm -f "$caddy_candidate" "$caddy_temporary" "$function_temporary"
  [ -d "$portal_stage" ] && rm -rf "$portal_stage" || true
  exit "$code"
}
trap rollback ERR INT TERM

awk -v marker="$portal_marker" '
  $0 == "{$PROXY_DOMAIN}, lemtel.assistantvirtualai.com {" {
    print
    print "  " marker
    print "  @lemtel_operations_portal path /lemtel-portal /lemtel-portal/*"
    print "  handle @lemtel_operations_portal {"
    print "    uri strip_prefix /lemtel-portal"
    print "    root * /etc/caddy/lemtel-portal"
    print "    try_files {path} /lemtel-portal.html"
    print "    file_server"
    print "  }"
    next
  }
  { print }
' "$caddyfile" > "$caddy_candidate"
docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$caddy_candidate" >/dev/null || fail caddy_candidate_invalid

cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup_caddy"
cp --preserve=mode,ownership,timestamps -- "$function_target" "$backup_function"
tar -xf "$portal_archive" -C "$portal_stage"
[ -s "$portal_stage/lemtel-portal.html" ] || fail portal_archive_invalid
[ ! -e "$portal_dir" ] || fail portal_directory_already_exists

# Schema has no business data and is idempotent. Existing data is never modified.
docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
table_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('"'"'public.lemtel_operational_status'"'"')::text"' 2>/dev/null || true)"
[ "$table_state" = 'lemtel_operational_status' ] || fail operational_status_schema_missing

cp -- "$function_source" "$function_temporary"
chmod --reference="$function_target" "$function_temporary"
mv -f "$function_temporary" "$function_target"
function_replaced=true
docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running_after_restart

mv "$portal_stage" "$portal_dir"
portal_replaced=true
cp -- "$caddy_candidate" "$caddy_temporary"
chmod --reference="$caddyfile" "$caddy_temporary"
mv -f "$caddy_temporary" "$caddyfile"
caddy_replaced=true
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail live_caddyfile_invalid
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_reload_failed

LEMTEL_HA_EXECUTE=enable_redacted_promoted_writer_status_timer \
LEMTEL_HA_ROLE=digitalocean_promoted_writer \
LEMTEL_HA_STATUS_PUBLISHER_PATH="$publisher_source" \
bash "$timer_source"
timer_enabled=true
systemctl is-active --quiet lemtel-ha-promoted-writer-status.timer || fail status_timer_not_active
snapshot_count="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM public.lemtel_operational_status"' 2>/dev/null || true)"
[ "$snapshot_count" = 1 ] || fail initial_redacted_snapshot_missing

caddy_replaced=false
function_replaced=false
portal_replaced=false
trap - ERR INT TERM
rm -f "$caddy_candidate"
printf 'operations_portal_deploy_format=lemtel_operations_portal_deploy_v1\n'
printf 'writer=digitalocean_promoted_writer\n'
printf 'portal_route=deployed\n'
printf 'schema_migration=applied\n'
printf 'onboarding_function=deployed\n'
printf 'redacted_status_timer=enabled\n'
printf 'hostinger_started=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_dns_failover_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'operations_portal_deploy_status=complete\n'
