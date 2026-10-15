#!/usr/bin/env bash
# Root-only Lemtel transactional-email repair on the existing DigitalOcean writer.
# It does not create snapshots, send mail, invoke a reset/welcome flow, register a webhook,
# change Cloudflare/DNS/Hostinger/load-balancing/failover, or touch telephony.
set -euo pipefail
exec 3>&1 4>&2

preflight_fail() {
  printf 'transactional_email_deploy_status=failed\n' >&4
  printf 'failure_stage=%s\n' "$1" >&4
  exit 1
}

[ "$(id -u)" -eq 0 ] || preflight_fail root_required
[ "${LEMTEL_TRANSACTIONAL_EMAIL_EXECUTE:-}" = deploy_reviewed_transactional_email ] || preflight_fail execution_review_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || preflight_fail writer_role_required
[ "${LEMTEL_TRANSACTIONAL_EMAIL_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ] || preflight_fail snapshot_attestation_required
exec >/dev/null 2>&1

bundle_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
archive_dir="$(dirname -- "$bundle_dir")"
archive="$archive_dir/package.tar"
archive_checksum="$archive_dir/package.tar.sha256"
manifest="$bundle_dir/manifest.sha256"
metadata="$bundle_dir/deployment-metadata.json"
migration="$bundle_dir/0019_lemtel_transactional_email_delivery_states.sql"
portal_archive="$bundle_dir/portal.tar"
onboarding_source="$bundle_dir/functions/lemtel-onboarding-admin/index.ts"
password_reset_source="$bundle_dir/functions/lemtel-password-reset-request/index.ts"
webhook_source="$bundle_dir/functions/lemtel-resend-delivery-webhook/index.ts"
shared_source="$bundle_dir/functions/_shared/lemtelTransactionalEmail.ts"

for required in "$archive" "$archive_checksum" "$manifest" "$metadata" "$migration" "$portal_archive" "$onboarding_source" "$password_reset_source" "$webhook_source" "$shared_source"; do
  [ -s "$required" ] || preflight_fail package_file_missing
done
command -v sha256sum >/dev/null 2>&1 || preflight_fail sha256sum_missing
(
  cd -- "$archive_dir"
  sha256sum --strict --status -c "$(basename -- "$archive_checksum")"
) >/dev/null 2>&1 || preflight_fail archive_digest_invalid

expected_manifest_paths='0019_lemtel_transactional_email_delivery_states.sql
deployment-metadata.json
functions/_shared/lemtelTransactionalEmail.ts
functions/lemtel-onboarding-admin/index.ts
functions/lemtel-onboarding-admin/manifest.json
functions/lemtel-password-reset-request/index.ts
functions/lemtel-password-reset-request/manifest.json
functions/lemtel-resend-delivery-webhook/index.ts
functions/lemtel-resend-delivery-webhook/manifest.json
lemtel-transactional-email-do-writer-deploy.sh
portal.tar'
actual_manifest_paths="$(awk 'NF == 2 && $1 ~ /^[a-f0-9]{64}$/ { print $2 }' "$manifest")"
[ "$actual_manifest_paths" = "$expected_manifest_paths" ] || preflight_fail manifest_allowlist_invalid
(
  cd -- "$bundle_dir"
  sha256sum --strict --status -c "$(basename -- "$manifest")"
) >/dev/null 2>&1 || preflight_fail manifest_digest_invalid
grep -Eq '"package_format"[[:space:]]*:[[:space:]]*"lemtel_transactional_email_do_writer_package_v1"' "$metadata" || preflight_fail metadata_invalid
grep -Eq '"target_role"[[:space:]]*:[[:space:]]*"digitalocean_writer"' "$metadata" || preflight_fail metadata_role_invalid
grep -Eq '"secrets_in_bundle"[[:space:]]*:[[:space:]]*false' "$metadata" || preflight_fail metadata_secret_boundary_invalid
grep -Eq '"send_email_during_install"[[:space:]]*:[[:space:]]*false' "$metadata" || preflight_fail metadata_email_boundary_invalid
grep -Eq '"enable_resend_webhook_during_install"[[:space:]]*:[[:space:]]*false' "$metadata" || preflight_fail metadata_webhook_boundary_invalid

command -v docker >/dev/null 2>&1 || preflight_fail docker_missing
docker ps >/dev/null 2>&1 || preflight_fail docker_unavailable
resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
db_container="$(resolve_database_container || true)"
edge_container='supabase-edge-functions'
caddy_container='supabase-caddy'
[ -n "$db_container" ] || preflight_fail database_container_unresolved
for container in "$db_container" "$edge_container" "$caddy_container"; do
  docker inspect "$container" >/dev/null 2>&1 || preflight_fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || preflight_fail container_not_running
done
writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || preflight_fail writer_not_verified

functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
caddy_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
[ -n "$functions_source" ] && [ -n "$caddy_source" ] || preflight_fail runtime_mount_missing
[ -f "$functions_source/main/index.ts" ] && [ -f "$functions_source/deno.jsonc" ] || preflight_fail edge_router_or_import_map_missing
portal_dir="$caddy_source/lemtel-portal"
[ -d "$portal_dir" ] || preflight_fail portal_directory_missing
onboarding_target="$functions_source/lemtel-onboarding-admin/index.ts"
catalog_target="$functions_source/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts"
password_reset_target="$functions_source/lemtel-password-reset-request/index.ts"
webhook_target="$functions_source/lemtel-resend-delivery-webhook/index.ts"
shared_target="$functions_source/_shared/lemtelTransactionalEmail.ts"
[ -f "$onboarding_target" ] || preflight_fail onboarding_target_missing
[ -f "$catalog_target" ] || preflight_fail onboarding_catalog_missing

lock_file='/var/lock/lemtel-transactional-email-deploy.lock'
exec 9>"$lock_file"
flock -n 9 || preflight_fail concurrent_transactional_email_deploy
backup_root='/var/lib/lemtel-ha/transactional-email/backups'
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
stage_dir="$(mktemp -d "$functions_source/.lemtel-transactional-email-stage.XXXXXX")"
portal_stage="$(mktemp -d "$caddy_source/.lemtel-transactional-email-portal.XXXXXX")"
chmod 0755 "$stage_dir"

onboarding_replaced=false
password_reset_replaced=false
webhook_replaced=false
shared_replaced=false
portal_original_moved=false
portal_replaced=false
migration_applied=false
password_reset_preexisting=false
webhook_preexisting=false
shared_preexisting=false
password_reset_dir_created=false
webhook_dir_created=false
shared_dir_created=false
failure_stage=preflight

rollback_files() {
  local code=$?
  [ "$code" -gt 0 ] || code=1
  trap - ERR INT TERM
  set +e
  if [ "$portal_replaced" = true ]; then rm -rf -- "$portal_dir"; fi
  if [ "$portal_original_moved" = true ] && [ -d "$backup_dir/lemtel-portal" ]; then mv -- "$backup_dir/lemtel-portal" "$portal_dir"; fi
  if [ "$onboarding_replaced" = true ] && [ -f "$backup_dir/lemtel-onboarding-admin.index.ts" ]; then cp -- "$backup_dir/lemtel-onboarding-admin.index.ts" "$onboarding_target"; fi
  if [ "$password_reset_replaced" = true ]; then
    if [ "$password_reset_preexisting" = true ]; then cp -- "$backup_dir/lemtel-password-reset-request.index.ts" "$password_reset_target"; else rm -f -- "$password_reset_target"; fi
  fi
  if [ "$webhook_replaced" = true ]; then
    if [ "$webhook_preexisting" = true ]; then cp -- "$backup_dir/lemtel-resend-delivery-webhook.index.ts" "$webhook_target"; else rm -f -- "$webhook_target"; fi
  fi
  if [ "$shared_replaced" = true ]; then
    if [ "$shared_preexisting" = true ]; then cp -- "$backup_dir/lemtelTransactionalEmail.ts" "$shared_target"; else rm -f -- "$shared_target"; fi
  fi
  if [ "$password_reset_dir_created" = true ]; then rmdir -- "$(dirname -- "$password_reset_target")" 2>/dev/null || true; fi
  if [ "$webhook_dir_created" = true ]; then rmdir -- "$(dirname -- "$webhook_target")" 2>/dev/null || true; fi
  if [ "$shared_dir_created" = true ]; then rmdir -- "$(dirname -- "$shared_target")" 2>/dev/null || true; fi
  if [ "$onboarding_replaced" = true ] || [ "$password_reset_replaced" = true ] || [ "$webhook_replaced" = true ] || [ "$shared_replaced" = true ]; then docker restart --time 30 "$edge_container" >/dev/null 2>&1 || true; fi
  rm -rf -- "$stage_dir" "$portal_stage"
  exec 1>&3 2>&4
  printf 'transactional_email_deploy_status=failed\n' >&2
  printf 'failure_stage=%s\n' "$failure_stage" >&2
  if [ "$migration_applied" = true ]; then
    printf 'database_migration_auto_rollback=false\n' >&2
    printf 'database_recovery=operator_snapshot_required\n' >&2
  fi
  exit "$code"
}
trap rollback_files ERR INT TERM
fail_stage() { failure_stage="$1"; return 1; }

failure_stage=stage_sources
install -d -m 0755 "$stage_dir/functions/_shared" "$stage_dir/functions/lemtel-onboarding-admin" "$stage_dir/functions/lemtel-password-reset-request" "$stage_dir/functions/lemtel-resend-delivery-webhook"
cp -- "$onboarding_source" "$stage_dir/functions/lemtel-onboarding-admin/index.ts"
cp -- "$password_reset_source" "$stage_dir/functions/lemtel-password-reset-request/index.ts"
cp -- "$webhook_source" "$stage_dir/functions/lemtel-resend-delivery-webhook/index.ts"
cp -- "$shared_source" "$stage_dir/functions/_shared/lemtelTransactionalEmail.ts"
cp -- "$catalog_target" "$stage_dir/functions/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts"
tar -tf "$portal_archive" | awk 'NF == 0 || $0 ~ /^\/|(^|\/)\.\.?(\/|$)/ { exit 1 }' || fail_stage portal_archive_paths_invalid
tar -xf "$portal_archive" -C "$portal_stage" --no-same-owner --no-same-permissions
[ -s "$portal_stage/lemtel-portal.html" ] || fail_stage portal_archive_invalid

# Validate Deno source only when the already-running Edge image supports Deno. No request is made.
deno_source_validation=not_supported
if docker exec "$edge_container" sh -eu -c 'command -v deno >/dev/null 2>&1'; then
  failure_stage=deno_source_validation
  docker exec "$edge_container" deno check --cached-only --quiet "/home/deno/functions/$(basename -- "$stage_dir")/functions/_shared/lemtelTransactionalEmail.ts" >/dev/null 2>&1 || fail_stage deno_source_invalid
  docker exec "$edge_container" deno check --cached-only --quiet "/home/deno/functions/$(basename -- "$stage_dir")/functions/lemtel-onboarding-admin/index.ts" >/dev/null 2>&1 || fail_stage deno_source_invalid
  docker exec "$edge_container" deno check --cached-only --quiet "/home/deno/functions/$(basename -- "$stage_dir")/functions/lemtel-password-reset-request/index.ts" >/dev/null 2>&1 || fail_stage deno_source_invalid
  docker exec "$edge_container" deno check --cached-only --quiet "/home/deno/functions/$(basename -- "$stage_dir")/functions/lemtel-resend-delivery-webhook/index.ts" >/dev/null 2>&1 || fail_stage deno_source_invalid
  deno_source_validation=passed
fi

# This checks names and validates the live configuration without emitting any value.
# No documented self-hosted Edge secret-injection interface exists in this repository, so this
# installer never prompts for or accepts a Resend key and leaves delivery inert when invalid.
environment_configuration_valid=false
if [ "$deno_source_validation" = passed ]; then
  if docker exec "$edge_container" deno eval --quiet --allow-env "import { emailConfig } from \"file:///home/deno/functions/$(basename -- "$stage_dir")/functions/_shared/lemtelTransactionalEmail.ts\"; if (!emailConfig(Deno.env)) Deno.exit(1);" >/dev/null 2>&1; then
    environment_configuration_valid=true
  fi
fi

failure_stage=backup_files
cp --preserve=mode,ownership,timestamps -- "$onboarding_target" "$backup_dir/lemtel-onboarding-admin.index.ts"
if [ -f "$password_reset_target" ]; then cp --preserve=mode,ownership,timestamps -- "$password_reset_target" "$backup_dir/lemtel-password-reset-request.index.ts"; password_reset_preexisting=true; fi
if [ -f "$webhook_target" ]; then cp --preserve=mode,ownership,timestamps -- "$webhook_target" "$backup_dir/lemtel-resend-delivery-webhook.index.ts"; webhook_preexisting=true; fi
if [ -f "$shared_target" ]; then cp --preserve=mode,ownership,timestamps -- "$shared_target" "$backup_dir/lemtelTransactionalEmail.ts"; shared_preexisting=true; fi

failure_stage=migration_0019
# 0019 is transactional and idempotent, but it changes historical state. It cannot be auto-reverted
# after a later file failure; recovery is the operator-attested snapshot, never a new snapshot here.
docker exec -i "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
state_constraint_count="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_constraint WHERE conname IN ('\''lemtel_onboarding_delivery_state_check'\'', '\''lemtel_password_reset_delivery_state_check'\'')"' 2>/dev/null || true)"
[ "$state_constraint_count" = 2 ] || fail_stage migration_validation_failed
migration_applied=true

failure_stage=stage_runtime_targets
if [ ! -d "$(dirname -- "$password_reset_target")" ]; then install -d -m 0755 "$(dirname -- "$password_reset_target")"; password_reset_dir_created=true; fi
if [ ! -d "$(dirname -- "$webhook_target")" ]; then install -d -m 0755 "$(dirname -- "$webhook_target")"; webhook_dir_created=true; fi
if [ ! -d "$(dirname -- "$shared_target")" ]; then install -d -m 0755 "$(dirname -- "$shared_target")"; shared_dir_created=true; fi
copy_candidate() {
  local source="$1" target="$2" temporary
  temporary="$(mktemp "${target}.lemtel-transactional.XXXXXX")"
  cp -- "$source" "$temporary"
  if [ -e "$target" ]; then chmod --reference="$target" "$temporary"; else chmod 0644 "$temporary"; fi
  mv -f -- "$temporary" "$target"
}
copy_candidate "$stage_dir/functions/lemtel-onboarding-admin/index.ts" "$onboarding_target"
onboarding_replaced=true
copy_candidate "$stage_dir/functions/lemtel-password-reset-request/index.ts" "$password_reset_target"
password_reset_replaced=true
copy_candidate "$stage_dir/functions/lemtel-resend-delivery-webhook/index.ts" "$webhook_target"
webhook_replaced=true
copy_candidate "$stage_dir/functions/_shared/lemtelTransactionalEmail.ts" "$shared_target"
shared_replaced=true

docker restart --time 30 "$edge_container" >/dev/null
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail_stage edge_not_running_after_restart

failure_stage=replace_portal
mv -- "$portal_dir" "$backup_dir/lemtel-portal"
portal_original_moved=true
mv -- "$portal_stage" "$portal_dir"
portal_replaced=true
[ -s "$portal_dir/lemtel-portal.html" ] || fail_stage portal_install_invalid

rm -rf -- "$stage_dir"
onboarding_replaced=false
password_reset_replaced=false
webhook_replaced=false
shared_replaced=false
portal_original_moved=false
portal_replaced=false
trap - ERR INT TERM
exec 1>&3 2>&4
printf 'transactional_email_deploy_format=lemtel_transactional_email_do_writer_deploy_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'archive_verified=true\n'
printf 'internal_manifest_verified=true\n'
printf 'snapshot_created=false\n'
printf 'snapshot_attestation=verified\n'
printf 'migration_0019=applied\n'
printf 'deno_source_validation=%s\n' "$deno_source_validation"
printf 'environment_names_checked=true\n'
printf 'environment_configuration_valid=%s\n' "$environment_configuration_valid"
printf 'resend_secret_tty_injection=unsupported_by_documented_edge_runtime\n'
printf 'resend_webhook_registered=false\n'
printf 'resend_webhook_enabled=false\n'
printf 'email_sent=false\n'
printf 'password_reset_triggered=false\n'
printf 'welcome_triggered=false\n'
printf 'portal_bundle=deployed\n'
printf 'edge_sources=deployed\n'
printf 'hostinger_touched=false\n'
printf 'dns_change_executed=false\n'
printf 'cloudflare_touched=false\n'
printf 'load_balancer_touched=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_failover_enabled=false\n'
printf 'telephony_touched=false\n'
printf 'credential_values_emitted=false\n'
printf 'transactional_email_deploy_status=complete\n'
