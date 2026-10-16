#!/usr/bin/env bash
# Root-only, strictly read-only runtime preflight for a future Lemtel traffic transaction.
# It emits only redacted state and never changes local or remote runtime state.
set +x
set -euo pipefail

fail() {
  local reason="$1"
  trap - ERR
  printf 'traffic_runtime_preflight_format=lemtel_traffic_runtime_preflight_v1\n'
  printf 'activation_preflight_ready=false\n'
  printf 'traffic_runtime_preflight_status=failed\n'
  printf 'reason=%s\n' "$reason"
  exit 1
}

trap 'fail preflight_refused' ERR

[[ "$EUID" -eq 0 ]] || fail root_required
[[ "$#" -eq 0 ]] || fail invalid_arguments
[[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ]] || fail writer_role_required

container_ids_for() {
  local expected_name="$1"
  docker ps -a --filter "name=^/${expected_name}$" --format '{{.ID}}' 2>/dev/null
}

inspect_running() {
  local container="$1" state
  state="$(docker inspect --format '{{if .State.Running}}true{{else}}false{{end}}' "$container" 2>/dev/null || true)"
  [[ "$state" = true ]] && printf true || printf false
}

inspect_label_presence() {
  local container="$1" label="$2" state
  state="$(docker inspect --format "{{if index .Config.Labels \"${label}\"}}present{{else}}missing{{end}}" "$container" 2>/dev/null || true)"
  [[ "$state" = present ]] && printf present || printf missing
}

inspect_mount_source() {
  local container="$1" destination="$2"
  docker inspect --format "{{range .Mounts}}{{if eq .Destination \"${destination}\"}}{{.Source}}{{end}}{{end}}" "$container" 2>/dev/null || true
}

unit_state() {
  local unit="$1" load_state active_state enabled_state
  load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
  active_state="$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null || true)"
  enabled_state="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  if [[ "$load_state" != loaded ]]; then
    printf absent
  elif [[ "$active_state" = inactive && ( "$enabled_state" = disabled || "$enabled_state" = static || "$enabled_state" = indirect || "$enabled_state" = masked ) ]]; then
    printf disabled
  else
    # Any active, enabled, failed, transitional, or unknown loaded unit is unsafe.
    printf active
  fi
}

route_state_for() {
  local caddyfile="$1" route_marker='# LEMTEL_TRAFFIC_INGRESS_V1' all_markers exact_markers
  all_markers="$(grep -F -c -- "$route_marker" "$caddyfile" 2>/dev/null || true)"
  exact_markers="$(grep -F -x -c -- "$route_marker" "$caddyfile" 2>/dev/null || true)"
  if [[ "$all_markers" = 0 && "$exact_markers" = 0 ]]; then
    if grep -F -q -- '/functions/v1/lemtel-traffic-ingest' "$caddyfile" 2>/dev/null; then
      printf invalid
    else
      printf absent
    fi
    return
  fi
  if [[ "$all_markers" = 1 && "$exact_markers" = 1 ]] && awk -v marker="$route_marker" '
    $0 == marker { marker_seen += 1; in_marker = 1; next }
    in_marker && /^[[:space:]]*@lemtel_traffic_ingest[[:space:]]+path[[:space:]]+\/functions\/v1\/lemtel-traffic-ingest[[:space:]]*$/ { path_seen += 1; next }
    in_marker && /^[[:space:]]*handle[[:space:]]+@lemtel_traffic_ingest[[:space:]]*\{[[:space:]]*$/ { handle_seen += 1; in_handle = 1; next }
    in_handle && /^[[:space:]]*log_skip[[:space:]]*$/ { log_skip_seen += 1; next }
    in_handle && /^[[:space:]]*}[[:space:]]*$/ { handle_closed = 1; exit }
    END { exit !(marker_seen == 1 && path_seen == 1 && handle_seen == 1 && log_skip_seen == 1 && handle_closed == 1) }
  ' "$caddyfile" >/dev/null 2>&1; then
    printf ready
  else
    printf invalid
  fi
}

collector_config_state() {
  local collector_config='/etc/lemtel-ha/traffic-collector.env' metadata owner mode file_type
  if [[ ! -e "$collector_config" && ! -L "$collector_config" ]]; then
    printf absent
    return
  fi
  if [[ -L "$collector_config" ]]; then
    printf unsafe
    return
  fi
  metadata="$(stat --format='%u:%a:%F' -- "$collector_config" 2>/dev/null || true)"
  IFS=: read -r owner mode file_type <<< "$metadata"
  if [[ "$owner" = 0 && "$mode" = 600 && "$file_type" = 'regular file' ]]; then
    printf safe
  else
    printf unsafe
  fi
}

command -v docker >/dev/null 2>&1 || fail local_runtime_unavailable
command -v systemctl >/dev/null 2>&1 || fail local_runtime_unavailable
docker ps -a --format '{{.ID}}' >/dev/null 2>&1 || fail local_runtime_unavailable
systemctl show --property=LoadState --value lemtel-traffic-collector.timer >/dev/null 2>&1 || fail local_runtime_unavailable

compose_command=missing
if docker compose version >/dev/null 2>&1; then
  compose_command=available
fi

mapfile -t caddy_candidates < <(container_ids_for supabase-caddy)
mapfile -t edge_candidates < <(container_ids_for supabase-edge-functions)
caddy_candidate_count="${#caddy_candidates[@]}"
edge_candidate_count="${#edge_candidates[@]}"
caddy_candidate_unique=false
edge_candidate_unique=false
caddy_running=false
edge_running=false
caddy_mount=missing
edge_functions_mount=missing
edge_functions_source=missing
edge_admin_source=missing
edge_traffic_ingest_source=missing
ingress_route=invalid
caddy_compose_project_label=missing
caddy_compose_service_label=missing
caddy_compose_config_files_label=missing
edge_compose_project_label=missing
edge_compose_service_label=missing
edge_compose_config_files_label=missing

if [[ "$caddy_candidate_count" -eq 1 ]]; then
  caddy_candidate_unique=true
  caddy_container="${caddy_candidates[0]}"
  caddy_running="$(inspect_running "$caddy_container")"
  caddy_compose_project_label="$(inspect_label_presence "$caddy_container" com.docker.compose.project)"
  caddy_compose_service_label="$(inspect_label_presence "$caddy_container" com.docker.compose.service)"
  caddy_compose_config_files_label="$(inspect_label_presence "$caddy_container" com.docker.compose.project.config_files)"
  caddy_mount_source="$(inspect_mount_source "$caddy_container" /etc/caddy)"
  if [[ -n "$caddy_mount_source" && -d "$caddy_mount_source" ]]; then
    caddy_mount=present
    if [[ -f "$caddy_mount_source/Caddyfile" ]]; then
      caddyfile=present
      ingress_route="$(route_state_for "$caddy_mount_source/Caddyfile")"
    fi
  fi
fi

if [[ "$edge_candidate_count" -eq 1 ]]; then
  edge_candidate_unique=true
  edge_container="${edge_candidates[0]}"
  edge_running="$(inspect_running "$edge_container")"
  edge_compose_project_label="$(inspect_label_presence "$edge_container" com.docker.compose.project)"
  edge_compose_service_label="$(inspect_label_presence "$edge_container" com.docker.compose.service)"
  edge_compose_config_files_label="$(inspect_label_presence "$edge_container" com.docker.compose.project.config_files)"
  edge_functions_mount_source="$(inspect_mount_source "$edge_container" /home/deno/functions)"
  if [[ -n "$edge_functions_mount_source" && -d "$edge_functions_mount_source" ]]; then
    edge_functions_mount=present
    edge_functions_source=present
    [[ -s "$edge_functions_mount_source/lemtel-onboarding-admin/index.ts" ]] && edge_admin_source=present
    if [[ -s "$edge_functions_mount_source/lemtel-traffic-ingest/index.ts" && -s "$edge_functions_mount_source/lemtel-traffic-ingest/manifest.json" ]]; then
      edge_traffic_ingest_source=present
    fi
  fi
fi

collector_config="$(collector_config_state)"
collector_timer="$(unit_state lemtel-traffic-collector.timer)"
collector_service="$(unit_state lemtel-traffic-collector.service)"
activation_preflight_ready=false
if [[ "$compose_command" = available \
  && "$caddy_candidate_unique" = true && "$caddy_running" = true && "$caddy_mount" = present && "$caddyfile" = present \
  && ( "$ingress_route" = absent || "$ingress_route" = ready ) \
  && "$edge_candidate_unique" = true && "$edge_running" = true && "$edge_functions_mount" = present && "$edge_functions_source" = present && "$edge_admin_source" = present && "$edge_traffic_ingest_source" = present \
  && "$caddy_compose_project_label" = present && "$caddy_compose_service_label" = present && "$caddy_compose_config_files_label" = present \
  && "$edge_compose_project_label" = present && "$edge_compose_service_label" = present && "$edge_compose_config_files_label" = present \
  && ( "$collector_config" = absent || "$collector_config" = safe ) \
  && "$collector_timer" != active && "$collector_service" != active ]]; then
  activation_preflight_ready=true
fi

printf 'traffic_runtime_preflight_format=lemtel_traffic_runtime_preflight_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'read_only=true\n'
printf 'remote_contacted=false\n'
printf 'caddy_candidate_count=%s\n' "$caddy_candidate_count"
printf 'caddy_candidate_unique=%s\n' "$caddy_candidate_unique"
printf 'caddy_running=%s\n' "$caddy_running"
printf 'caddy_mount=%s\n' "$caddy_mount"
printf 'caddyfile=%s\n' "$caddyfile"
printf 'ingress_route=%s\n' "$ingress_route"
printf 'caddy_compose_project_label=%s\n' "$caddy_compose_project_label"
printf 'caddy_compose_service_label=%s\n' "$caddy_compose_service_label"
printf 'caddy_compose_config_files_label=%s\n' "$caddy_compose_config_files_label"
printf 'edge_candidate_count=%s\n' "$edge_candidate_count"
printf 'edge_candidate_unique=%s\n' "$edge_candidate_unique"
printf 'edge_running=%s\n' "$edge_running"
printf 'edge_functions_mount=%s\n' "$edge_functions_mount"
printf 'edge_functions_source=%s\n' "$edge_functions_source"
printf 'edge_admin_source=%s\n' "$edge_admin_source"
printf 'edge_traffic_ingest_source=%s\n' "$edge_traffic_ingest_source"
printf 'edge_compose_project_label=%s\n' "$edge_compose_project_label"
printf 'edge_compose_service_label=%s\n' "$edge_compose_service_label"
printf 'edge_compose_config_files_label=%s\n' "$edge_compose_config_files_label"
printf 'compose_command=%s\n' "$compose_command"
printf 'collector_config=%s\n' "$collector_config"
printf 'collector_timer=%s\n' "$collector_timer"
printf 'collector_service=%s\n' "$collector_service"
printf 'credential_values_emitted=false\n'
printf 'collector_activation_authorized=false\n'
printf 'activation_preflight_ready=%s\n' "$activation_preflight_ready"
if [[ "$activation_preflight_ready" = true ]]; then
  printf 'traffic_runtime_preflight_status=complete\n'
else
  printf 'reason=runtime_not_ready\n'
  printf 'traffic_runtime_preflight_status=failed\n'
  exit 1
fi
