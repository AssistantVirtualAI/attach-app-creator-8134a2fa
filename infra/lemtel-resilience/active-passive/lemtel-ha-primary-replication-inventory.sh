#!/usr/bin/env bash
# Read-only primary inventory for the Lemtel availability-first active-passive rollout.
# This script does not write files, modify containers, print credentials, or contact telephony.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'inventory_status=root_required\n' >&2
    exit 1
  fi
}

bool() {
  if "$@" >/dev/null 2>&1; then printf true; else printf false; fi
}

inspect_mounts() {
  local prefix="$1" container="$2"
  docker inspect --format '{{range .Mounts}}{{printf "%s|%s|%s\n" .Type .Source .Destination}}{{end}}' "$container" \
    | while IFS='|' read -r mount_type mount_source mount_destination; do
        [ -n "$mount_destination" ] || continue
        printf '%s_mount=%s|%s|%s\n' "$prefix" "$mount_type" "$mount_source" "$mount_destination"
      done
}

require_root
role="${LEMTEL_HA_ROLE:-hostinger_primary}"
db_container="${LEMTEL_DB_CONTAINER:-supabase-db}"
storage_container="${LEMTEL_STORAGE_CONTAINER:-supabase-storage}"

printf 'inventory_format=lemtel_primary_replication_inventory_v1\n'
printf 'declared_role=%s\n' "$role"
printf 'hostname=%s\n' "$(hostname -s)"
printf 'docker_available=%s\n' "$(bool command -v docker)"

if ! command -v docker >/dev/null 2>&1 || ! docker ps >/dev/null 2>&1; then
  printf 'docker_daemon_access=false\n'
  printf 'inventory_status=docker_unavailable_or_denied\n'
  exit 0
fi

printf 'docker_daemon_access=true\n'
printf 'database_container_present=%s\n' "$(bool docker inspect "$db_container")"
printf 'storage_container_present=%s\n' "$(bool docker inspect "$storage_container")"

if ! docker inspect "$db_container" >/dev/null 2>&1; then
  printf 'inventory_status=database_container_missing\n'
  exit 0
fi

printf 'database_image=%s\n' "$(docker inspect --format '{{.Config.Image}}' "$db_container")"
printf 'database_compose_working_dir=%s\n' "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$db_container")"
printf 'database_networks=%s\n' "$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{printf "%s " $name}}{{end}}' "$db_container" | xargs)"
printf 'database_port_bindings=%s\n' "$(docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{range $bindings}}{{printf "%s=%s:%s " $port .HostIp .HostPort}}{{end}}{{end}}{{end}}' "$db_container" | xargs)"
inspect_mounts database "$db_container"

postgres_settings="$(docker exec "$db_container" sh -eu -c '
  export PSQLRC=/dev/null
  psql -X -v ON_ERROR_STOP=1 -At -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}" <<'"'"'SQL'"'"'
SELECT '\''postgres_server_version='\'' || current_setting('\''server_version'\'');
SELECT '\''postgres_data_directory='\'' || current_setting('\''data_directory'\'');
SELECT '\''postgres_config_file='\'' || current_setting('\''config_file'\'');
SELECT '\''postgres_hba_file='\'' || current_setting('\''hba_file'\'');
SELECT '\''postgres_wal_level='\'' || current_setting('\''wal_level'\'');
SELECT '\''postgres_max_wal_senders='\'' || current_setting('\''max_wal_senders'\'');
SELECT '\''postgres_max_replication_slots='\'' || current_setting('\''max_replication_slots'\'');
SELECT '\''postgres_wal_keep_size='\'' || current_setting('\''wal_keep_size'\'');
SELECT '\''postgres_max_slot_wal_keep_size='\'' || current_setting('\''max_slot_wal_keep_size'\'');
SELECT '\''postgres_archive_mode='\'' || current_setting('\''archive_mode'\'');
SELECT '\''postgres_synchronous_standby_names='\'' || current_setting('\''synchronous_standby_names'\'');
SELECT '\''postgres_listen_addresses='\'' || current_setting('\''listen_addresses'\'');
SELECT '\''postgres_in_recovery='\'' || pg_is_in_recovery()::text;
SELECT '\''postgres_replication_slot_count='\'' || count(*)::text FROM pg_replication_slots;
SELECT '\''postgres_wal_sender_count='\'' || count(*)::text FROM pg_stat_replication;
SQL
' 2>/dev/null || true)"
if [ -n "$postgres_settings" ]; then
  printf '%s\n' "$postgres_settings"
  printf 'postgres_settings_status=complete\n'
else
  printf 'postgres_settings_status=unavailable\n'
fi

if docker inspect "$storage_container" >/dev/null 2>&1; then
  printf 'storage_image=%s\n' "$(docker inspect --format '{{.Config.Image}}' "$storage_container")"
  printf 'storage_compose_working_dir=%s\n' "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$storage_container")"
  inspect_mounts storage "$storage_container"
  storage_backend="$(docker exec "$storage_container" sh -c 'printf "%s" "${STORAGE_BACKEND:-unknown}"' 2>/dev/null || printf unknown)"
  case "$storage_backend" in
    file|filesystem|local)
      storage_path="$(docker exec "$storage_container" sh -c 'printf "%s" "${FILE_STORAGE_BACKEND_PATH:-unknown}"' 2>/dev/null || printf unknown)"
      printf 'storage_backend_class=filesystem\n'
      printf 'storage_filesystem_path=%s\n' "$storage_path"
      ;;
    s3|s3compatible)
      printf 'storage_backend_class=object_storage\n'
      ;;
    *)
      printf 'storage_backend_class=unknown\n'
      ;;
  esac
else
  printf 'storage_backend_class=container_missing\n'
fi

printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'inventory_status=complete\n'
