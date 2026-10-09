#!/usr/bin/env bash
# Transactional Hostinger-primary preparation for a private PostgreSQL physical standby.
# Requires an explicit execution token because it briefly recreates only the primary DB container.
# No public database binding, Storage synchronization, DNS routing, promotion, or telephony change is performed.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'primary_streaming_prepare_status=root_required\n' >&2
    exit 1
  fi
}

fail() {
  printf 'primary_streaming_prepare_status=%s\n' "$1" >&2
  exit 1
}

require_exact() {
  local label="$1" actual="$2" expected="$3"
  [ "$actual" = "$expected" ] || fail "unexpected_${label}"
}

require_root
[ "${LEMTEL_HA_EXECUTE:-}" = 'prepare_private_postgres_streaming' ] || fail execution_token_required
require_exact role "${LEMTEL_HA_ROLE:-}" hostinger_primary

primary_tunnel_address='10.253.47.1'
standby_tunnel_address='10.253.47.2'
replication_role='lemtel_ha_replication'
replication_slot='lemtel_do_standby'
db_container="${LEMTEL_HA_DB_CONTAINER:-supabase-db}"
db_service="${LEMTEL_HA_DB_SERVICE:-db}"
compose_dir="${LEMTEL_HA_COMPOSE_DIR:-/opt/lemtel-staging-bootstrap/lemtel-supabase}"
image_expected='supabase/postgres:17.6.1.136'
age_recipient="${LEMTEL_HA_STANDBY_AGE_RECIPIENT:-}"

case "$age_recipient" in
  age1[0-9a-z]*) ;;
  *) fail invalid_standby_age_recipient ;;
esac
[ -d "$compose_dir" ] || fail compose_directory_missing
command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 {print $2}')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
require_exact database_image "$(docker inspect --format '{{.Config.Image}}' "$db_container")" "$image_expected"
require_exact database_service "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$db_container")" "$db_service"

current_bindings="$(docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{range $bindings}}{{printf "%s=%s:%s " $port .HostIp .HostPort}}{{end}}{{end}}{{end}}' "$db_container" | xargs)"
[ -z "$current_bindings" ] || fail unexpected_existing_database_port_binding
compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$db_container")"
[ -n "$compose_project" ] || fail compose_project_missing
compose_files_csv="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$db_container")"
[ -n "$compose_files_csv" ] || fail compose_files_missing
IFS=',' read -r -a compose_files <<< "$compose_files_csv"
for file in "${compose_files[@]}"; do [ -f "$file" ] || fail compose_file_missing; done

hba_target="$compose_dir/volumes/db/lemtel-ha-pg_hba.conf"
override_target="$compose_dir/docker-compose.lemtel-ha-replication.yml"
secret_dir='/etc/lemtel-ha/secrets'
secret_file="$secret_dir/postgres-replication.password"
envelope_file="$compose_dir/volumes/db/lemtel-ha-replication-password.age"
sql_file="$(mktemp /root/lemtel-ha-replication.XXXXXX.sql)"
hba_tmp="$(mktemp "$compose_dir/volumes/db/.lemtel-ha-pg_hba.XXXXXX")"
override_tmp="$(mktemp "$compose_dir/.docker-compose.lemtel-ha-replication.XXXXXX")"
cleanup() { rm -f "$sql_file" "$hba_tmp" "$override_tmp"; }
trap cleanup EXIT
umask 077
install -d -m 0700 "$secret_dir"

if [ -f "$hba_target" ]; then
  grep -Fqx "host replication ${replication_role} ${standby_tunnel_address}/32 scram-sha-256" "$hba_target" || fail existing_hba_policy_mismatch
else
  docker cp "${db_container}:/etc/postgresql/pg_hba.conf" "$hba_tmp"
  [ -s "$hba_tmp" ] || fail hba_export_failed
  printf '\n# Lemtel active-passive physical replication over WireGuard only\nhost replication %s %s/32 scram-sha-256\n' "$replication_role" "$standby_tunnel_address" >> "$hba_tmp"
  # pg_hba.conf contains no credential value and must be readable by the postgres UID inside the container.
  install -m 0644 "$hba_tmp" "$hba_target"
fi

# Write the exact Compose override without exposing any runtime secret.
cat > "$override_tmp" <<EOF
services:
  ${db_service}:
    ports:
      - "${primary_tunnel_address}:5432:5432"
    volumes:
      - type: bind
        source: ./volumes/db/lemtel-ha-pg_hba.conf
        target: /etc/postgresql/pg_hba.conf
        read_only: true
EOF
if [ -f "$override_target" ]; then
  cmp -s "$override_tmp" "$override_target" || fail existing_compose_override_mismatch
else
  install -m 0600 "$override_tmp" "$override_target"
fi

compose_cmd=(docker compose --project-name "$compose_project")
for file in "${compose_files[@]}"; do compose_cmd+=(-f "$file"); done
compose_cmd+=(-f "$override_target")
"${compose_cmd[@]}" config -q

# The only planned interruption: recreate db with a port bound solely to the WireGuard address.
"${compose_cmd[@]}" up -d --no-deps --force-recreate "$db_service"
for _ in $(seq 1 45); do
  if docker inspect --format '{{.State.Running}}' "$db_container" 2>/dev/null | grep -qx true \
    && docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"' 2>/dev/null | grep -qx 1; then
    break
  fi
  sleep 2
done
docker inspect --format '{{.State.Running}}' "$db_container" | grep -qx true || fail database_container_not_running_after_recreate
docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"' | grep -qx 1 || fail database_not_ready_after_recreate

docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{range $bindings}}{{printf "%s=%s:%s\n" $port .HostIp .HostPort}}{{end}}{{end}}{{end}}' "$db_container" \
  | grep -Fxq "5432/tcp=${primary_tunnel_address}:5432" || fail private_database_binding_missing

role_exists="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '\''lemtel_ha_replication'\'')"')"
if [ "$role_exists" = false ] && [ -f "$secret_file" ]; then
  fail existing_secret_without_replication_role
fi
if [ "$role_exists" = true ] && [ ! -f "$secret_file" ]; then
  fail existing_replication_role_without_local_secret
fi
if [ ! -f "$secret_file" ]; then
  openssl rand -hex 32 > "$secret_file"
  chmod 0600 "$secret_file"
  password="$(cat "$secret_file")"
  cat > "$sql_file" <<EOF
CREATE ROLE ${replication_role} WITH LOGIN REPLICATION PASSWORD '${password}';
EOF
  docker cp "$sql_file" "${db_container}:/tmp/lemtel-ha-replication.sql"
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/lemtel-ha-replication.sql >/dev/null; rm -f /tmp/lemtel-ha-replication.sql'
fi

slot_kind="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT slot_type FROM pg_replication_slots WHERE slot_name = '\''lemtel_do_standby'\''"')"
case "$slot_kind" in
  '')
    docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_create_physical_replication_slot('\''lemtel_do_standby'\'')" >/dev/null'
    ;;
  physical) ;;
  *) fail existing_replication_slot_not_physical ;;
esac

age -r "$age_recipient" -o "$envelope_file" "$secret_file"
chmod 0600 "$envelope_file"

printf 'primary_streaming_prepare_format=lemtel_primary_streaming_prepare_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'database_container_recreated=true\n'
printf 'database_binding=%s:5432\n' "$primary_tunnel_address"
printf 'public_database_listener_enabled=false\n'
printf 'replication_role_created_or_verified=true\n'
printf 'physical_replication_slot_created_or_verified=true\n'
printf 'replication_secret_envelope_created=true\n'
printf 'plaintext_secret_replication=false\n'
printf 'storage_replication_started=false\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'primary_streaming_prepare_status=complete\n'
