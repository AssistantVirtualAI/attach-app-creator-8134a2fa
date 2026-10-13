#!/usr/bin/env bash
# Root-only, read-only verification for Lemtel password recovery on the DO writer.
# It emits presence and contract state only: never environment values, user data or passwords.
set -euo pipefail

fail() {
  printf 'password_recovery_preflight_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_READONLY:-}" = 'password_recovery_preflight' ] || fail readonly_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role

edge_container='supabase-edge-functions'
resolve_database_container() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}

db_container="$(resolve_database_container || true)"
[ -n "$db_container" ] || fail database_container_unresolved
docker inspect "$edge_container" >/dev/null 2>&1 || fail edge_runtime_missing
docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$edge_container")" = true ] || fail edge_runtime_not_running
[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" = true ] || fail database_not_running

# The intermediate Docker output is consumed by sed before it reaches stdout.
mapfile -t edge_env_names < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge_container" | sed 's/=.*//')
has_environment() {
  local expected="$1" value
  for value in "${edge_env_names[@]}"; do [ "$value" = "$expected" ] && return 0; done
  return 1
}

functions_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge_container")"
[ -n "$functions_source" ] || fail functions_mount_unresolved
function_source="$functions_source/lemtel-password-reset-request/index.ts"
function_state=missing
if [ -s "$function_source" ] \
  && grep -Fq 'lemtel_find_password_reset_recipient' "$function_source" \
  && grep -Fq 'RESEND_API_KEY' "$function_source"; then
  function_state=present
fi

database_contract="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT CASE WHEN to_regclass('\''public.lemtel_password_reset_throttles'\'') IS NOT NULL AND to_regclass('\''public.lemtel_password_reset_delivery_attempts'\'') IS NOT NULL AND to_regprocedure('\''public.lemtel_find_password_reset_recipient(text)'\'') IS NOT NULL AND to_regprocedure('\''public.lemtel_claim_password_reset(uuid,uuid,text,integer)'\'') IS NOT NULL AND to_regprocedure('\''public.lemtel_release_failed_password_reset(uuid)'\'') IS NOT NULL THEN '\''ready'\'' ELSE '\''missing'\'' END"' 2>/dev/null || true)"
[ "$database_contract" = ready ] || database_contract=missing

required_environment=(SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY LEMTEL_WELCOME_FROM)
all_environment_present=true
for name in "${required_environment[@]}"; do
  if has_environment "$name"; then
    printf 'environment_%s=present\n' "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  else
    printf 'environment_%s=missing\n' "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    all_environment_present=false
  fi
done

ready=false
if [ "$all_environment_present" = true ] && [ "$function_state" = present ] && [ "$database_contract" = ready ]; then ready=true; fi
printf 'password_recovery_preflight_format=lemtel_password_recovery_preflight_v1\n'
printf 'writer=digitalocean_promoted_writer\n'
printf 'edge_runtime=healthy\n'
printf 'function_source=%s\n' "$function_state"
printf 'database_contract=%s\n' "$database_contract"
printf 'password_recovery_ready=%s\n' "$ready"
printf 'hostinger_contacted=false\n'
printf 'runtime_mutated=false\n'
printf 'credential_values_emitted=false\n'
printf 'password_recovery_preflight_status=complete\n'
