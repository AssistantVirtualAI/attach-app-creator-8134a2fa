#!/usr/bin/env bash
# Root-only, read-only preflight for the Lemtel portal account-authority rollout.
# It never applies a migration, copies a function, restarts a container, sends email,
# changes DNS, contacts Hostinger, or alters telephony.
set -euo pipefail

fail() {
  printf 'account_authority_preflight_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail invalid_role

resolve_by_name() {
  local expected="$1"
  docker inspect "$expected" >/dev/null 2>&1 && { printf '%s' "$expected"; return; }
}

resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

bool() { if "$@" >/dev/null 2>&1; then printf true; else printf false; fi; }

command -v docker >/dev/null 2>&1 || fail docker_missing
docker ps >/dev/null 2>&1 || fail docker_unavailable

db_container="$(resolve_database_container || true)"
edge_container="$(resolve_by_name supabase-edge-functions || true)"
auth_container="$(resolve_by_name supabase-auth || true)"
[ -n "$db_container" ] || fail database_container_unresolved
[ -n "$edge_container" ] || fail edge_container_missing
[ -n "$auth_container" ] || fail auth_container_missing

for container in "$db_container" "$edge_container" "$auth_container"; do
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done

writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text"' 2>/dev/null || true)"
[ "$writer_state" = false ] || fail writer_not_verified

functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$functions_source" ] || fail function_mount_missing
[ -f "$functions_source/main/index.ts" ] || fail function_router_missing
[ -f "$functions_source/deno.jsonc" ] || fail function_import_map_missing

base_schema_ready="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (to_regclass('\''public.lemtel_organizations'\'') IS NOT NULL AND to_regclass('\''public.lemtel_organization_memberships'\'') IS NOT NULL AND to_regclass('\''public.lemtel_onboarding_audit'\'') IS NOT NULL)::text"' 2>/dev/null || true)"
password_recovery_schema_ready="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (to_regclass('\''public.lemtel_password_reset_throttles'\'') IS NOT NULL AND to_regclass('\''public.lemtel_password_reset_delivery_attempts'\'') IS NOT NULL)::text"' 2>/dev/null || true)"
authority_column="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '\''public'\'' AND table_name = '\''lemtel_organizations'\'' AND column_name = '\''account_authority_revision'\'')::text"' 2>/dev/null || true)"

has_env() {
  local name="$1"
  docker exec "$edge_container" sh -eu -c "test -n \"\${$name:-}\""
}

signup_disabled="$(docker exec "$auth_container" sh -eu -c 'test "${GOTRUE_DISABLE_SIGNUP:-false}" = true' >/dev/null 2>&1 && printf true || printf false)"

printf 'account_authority_preflight_format=lemtel_account_authority_preflight_v1\n'
printf 'writer_verified=true\n'
printf 'functions_mount_verified=true\n'
printf 'base_schema_ready=%s\n' "${base_schema_ready:-false}"
printf 'password_recovery_schema_ready=%s\n' "${password_recovery_schema_ready:-false}"
printf 'account_authority_revision_present=%s\n' "${authority_column:-false}"
printf 'public_signup_disabled=%s\n' "$signup_disabled"
printf 'edge_supabase_url_configured=%s\n' "$(bool has_env SUPABASE_URL)"
printf 'edge_service_role_configured=%s\n' "$(bool has_env SUPABASE_SERVICE_ROLE_KEY)"
printf 'edge_resend_configured=%s\n' "$(bool has_env RESEND_API_KEY)"
printf 'edge_sender_configured=%s\n' "$(bool has_env LEMTEL_WELCOME_FROM)"
printf 'hostinger_contacted=false\n'
printf 'dns_change_executed=false\n'
printf 'database_mutated=false\n'
printf 'edge_runtime_restarted=false\n'
printf 'email_sent=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'account_authority_preflight_status=complete\n'
