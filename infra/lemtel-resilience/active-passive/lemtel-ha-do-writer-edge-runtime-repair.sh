#!/usr/bin/env bash
# Root-only repair of the DO writer Edge Functions container's Compose chain.
# Each Lemtel activation recreated ONLY the functions service with an extra env file + override (transactional email,
# resource publisher secret, traffic collector secret). A later recreate from a fixed file list drops them. This tool
# rebuilds the exact chain: the project's base files and env file as recorded on a sibling container of the same project
# (never recreated), plus every activation override still present on disk, then recreates only the functions service.
#   check  : read-only — prints the chain it would use and which variable NAMES are missing now (never values).
#   repair : LEMTEL_EDGE_REPAIR_EXECUTE=rebuild_edge_functions_compose_chain — validate, recreate, prove the names.
set -euo pipefail
umask 077
T="${LEMTEL_ER_TEST_ROOT:-}"
fail() { printf 'edge_runtime_repair_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"; case "$mode" in check|repair) ;; *) fail usage_check_or_repair ;; esac
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
edge='supabase-edge-functions'
label() { docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }
[ "$(docker inspect --format '{{.State.Running}}' "$edge" 2>/dev/null)" = true ] || fail edge_not_running
project="$(label "$edge" com.docker.compose.project)"; service="$(label "$edge" com.docker.compose.service)"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [[ "$service" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail compose_labels_invalid
# Base chain from a sibling container of the same project that was not recreated by the activations.
sibling=''
for c in supabase-rest supabase-auth supabase-storage supabase-meta supabase-kong supabase-envoy; do
  [ "$(label "$c" com.docker.compose.project)" = "$project" ] && { sibling="$c"; break; }
done
[ -n "$sibling" ] || fail sibling_container_unresolved
workdir="$T$(label "$sibling" com.docker.compose.project.working_dir)"
mapfile -t base_files < <(label "$sibling" com.docker.compose.project.config_files | tr ',' '\n' | sed '/^$/d')
mapfile -t base_env < <(label "$sibling" com.docker.compose.project.environment_file | tr ',' '\n' | sed '/^$/d')
[ "${#base_files[@]}" -gt 0 ] || fail base_config_files_unresolved
[ "${#base_env[@]}" -gt 0 ] || base_env=("${workdir#$T}/.env")
args=(--project-name "$project" --project-directory "$workdir")
for e in "${base_env[@]}"; do [ -f "$T$e" ] || fail base_env_file_missing; args+=(--env-file "$T$e"); done
files=()
for f in "${base_files[@]}"; do [ -f "$T$f" ] || fail base_config_file_missing; files+=(-f "$T$f"); done
# The Lemtel override (PBX connection variables) belongs to the chain even if the project was first started without it.
private_override="${workdir#$T}/docker-compose.lemtel-private.yml"
if [ -f "$T$private_override" ] && ! printf '%s\n' "${base_files[@]}" | grep -qx "$private_override"; then files+=(-f "$T$private_override"); base_files+=("$private_override"); fi
# Activation additions still on disk (each one: optional env file + override).
expected=(SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY)
add() { # $1 = env file or '-', $2 = override, $3.. = variable names it provides
  local env="$T$1" ov="$T$2"; shift 2
  [ -f "$ov" ] || return 0
  if [ "$env" != "$T-" ]; then [ -f "$env" ] || return 0; args+=(--env-file "$env"); fi
  files+=(-f "$ov"); expected+=("$@"); added+=("$(basename "$ov")")
}
added=()
add - /var/lib/lemtel-ha/transactional-email/runtime-config/compose.lemtel-transactional-email.yml RESEND_API_KEY LEMTEL_WELCOME_FROM
add /var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-secret.env /var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-resource-publisher.override.yaml LEMTEL_DO_WRITER_RESOURCE_SECRET
add /var/lib/lemtel-ha/traffic-observability/edge-config/edge-secret.env /var/lib/lemtel-ha/traffic-observability/edge-config/edge-traffic.override.yaml LEMTEL_TRAFFIC_COLLECTOR_SECRET
grep -q '^LEMTEL_PBX_SECRET_ENCRYPTION_KEY=' "$workdir/.env" 2>/dev/null && expected+=(LEMTEL_PBX_SECRET_ENCRYPTION_KEY)
names() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge" | cut -d= -f1 | sort -u; }
missing_now=(); now="$(names)"
for n in "${expected[@]}"; do printf '%s\n' "$now" | grep -qx "$n" || missing_now+=("$n"); done
docker compose "${args[@]}" "${files[@]}" config --quiet 2>/dev/null || fail compose_chain_invalid

printf 'edge_runtime_repair_format=lemtel_edge_runtime_repair_v1\nproject=%s\nservice=%s\nbase_from=%s\n' "$project" "$service" "$sibling"
printf 'base_files=%s\nactivation_overrides=%s\n' "$(printf '%s\n' "${base_files[@]}" | xargs -n1 basename | paste -sd, -)" "$(IFS=,; echo "${added[*]:-none}")"
printf 'missing_variable_names_now=%s\n' "$(IFS=,; echo "${missing_now[*]:-none}")"
if [ "$mode" = check ]; then printf 'changes_made=false\nedge_runtime_repair_status=check_passed\n'; exit 0; fi

[ "${LEMTEL_EDGE_REPAIR_EXECUTE:-}" = rebuild_edge_functions_compose_chain ] || fail execution_token_required
docker compose "${args[@]}" "${files[@]}" up -d --no-deps --force-recreate --no-build --pull never "$service" >/dev/null
ok=false; for _ in $(seq 1 30); do [ "$(docker inspect --format '{{.State.Running}}' "$edge" 2>/dev/null)" = true ] && { ok=true; break; }; sleep 2; done
[ "$ok" = true ] || fail edge_not_running_after_repair
after="$(names)"; still=()
for n in "${expected[@]}"; do printf '%s\n' "$after" | grep -qx "$n" || still+=("$n"); done
[ "${#still[@]}" -eq 0 ] || fail "variables_still_missing_$(IFS=_; echo "${still[*]}" | tr A-Z a-z)"
printf 'edge_recreated=true\nall_expected_variable_names_present=true\nsecret_values_printed=false\nedge_runtime_repair_status=complete\n'
