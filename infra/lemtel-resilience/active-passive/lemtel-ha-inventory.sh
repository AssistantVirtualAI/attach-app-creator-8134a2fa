#!/usr/bin/env bash
# Read-only, redacted inventory for the Lemtel active-passive rollout.
# It writes no files, prints no environment values, and does not contact FusionPBX/SIP.
set -euo pipefail

role="${LEMTEL_HA_ROLE:-unknown}"
db_container="${LEMTEL_DB_CONTAINER:-}"
storage_container="${LEMTEL_STORAGE_CONTAINER:-}"

printf 'inventory_format=lemtel_active_passive_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'hostname=%s\n' "$(hostname -s)"
printf 'os=%s\n' "$(. /etc/os-release && printf '%s %s' "$ID" "$VERSION_ID")"
printf 'docker_available=%s\n' "$(command -v docker >/dev/null 2>&1 && printf true || printf false)"

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker_compose_available=false\n'
  printf 'inventory_status=docker_unavailable\n'
  exit 0
fi

printf 'docker_compose_available=%s\n' "$(docker compose version >/dev/null 2>&1 && printf true || printf false)"

# A non-root operator must never infer an empty runtime from a denied Docker socket.
# The caller must use a separately approved root-side read-only inventory if this guard reports false.
if ! docker ps --format '{{.Names}}' >/dev/null 2>&1; then
  printf 'docker_daemon_access=false\n'
  printf 'inventory_status=docker_access_denied_or_daemon_unavailable\n'
  exit 0
fi

printf 'docker_daemon_access=true\n'
printf 'container_count=%s\n' "$(docker ps --format '{{.Names}}' | wc -l | tr -d ' ')"
while IFS='|' read -r name image; do
  [ -n "$name" ] || continue
  state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || printf unknown)"
  printf 'container=%s|image=%s|state=%s\n' "$name" "$image" "$state"
done < <(docker ps --format '{{.Names}}|{{.Image}}' | sort)

if [ -n "$db_container" ] && docker inspect "$db_container" >/dev/null 2>&1; then
  printf 'database_container_present=true\n'
  printf 'database_image=%s\n' "$(docker inspect --format '{{.Config.Image}}' "$db_container")"
  printf 'database_postgres_version=%s\n' "$(docker exec "$db_container" postgres --version 2>/dev/null | tr '\n' ' ' || printf unavailable)"
  printf 'database_mount_destinations=%s\n' "$(docker inspect --format '{{range .Mounts}}{{.Destination}} {{end}}' "$db_container" | xargs || true)"
  printf 'database_env_names=%s\n' "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$db_container" | cut -d= -f1 | sort | tr '\n' ',' | sed 's/,$//')"
else
  printf 'database_container_present=false\n'
fi

if [ -n "$storage_container" ] && docker inspect "$storage_container" >/dev/null 2>&1; then
  printf 'storage_container_present=true\n'
  printf 'storage_image=%s\n' "$(docker inspect --format '{{.Config.Image}}' "$storage_container")"
  printf 'storage_mount_destinations=%s\n' "$(docker inspect --format '{{range .Mounts}}{{.Destination}} {{end}}' "$storage_container" | xargs || true)"
  printf 'storage_env_names=%s\n' "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$storage_container" | cut -d= -f1 | sort | tr '\n' ',' | sed 's/,$//')"
else
  printf 'storage_container_present=false\n'
fi

printf 'fusionpbx_or_sip_contacted=false\n'
printf 'environment_values_emitted=false\n'
printf 'inventory_status=complete\n'
