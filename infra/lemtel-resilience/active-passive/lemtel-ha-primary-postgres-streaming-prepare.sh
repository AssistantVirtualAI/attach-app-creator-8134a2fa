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

wait_for_database() {
  local container="$1"
  for _ in $(seq 1 45); do
    if docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true \
      && docker exec "$container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"' 2>/dev/null | grep -qx 1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

query_database() {
  local query="$1"
  docker exec "$db_container" sh -eu -c "export PSQLRC=/dev/null; psql -X -At -F '|' -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"${query}\""
}

runtime_bindings() {
  docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{range $bindings}}{{printf "%s=%s:%s\n" $port .HostIp .HostPort}}{{end}}{{end}}{{end}}' "$db_container"
}

assert_no_runtime_bindings() {
  [ -z "$(runtime_bindings)" ] || return 1
}

assert_private_runtime_binding() {
  [ "$(runtime_bindings)" = "5432/tcp=${primary_tunnel_address}:5432" ]
}

validate_rendered_ports() {
  # Docker Compose JSON is inspected before a restart. The base topology must have no host port;
  # the replication topology must have exactly one TCP host binding on the WireGuard address.
  local policy="$1"
  shift
  "$@" config --format json | python3 -c '
import json
import sys
service, private_ip, policy = sys.argv[1:]
config = json.load(sys.stdin)
ports = config.get("services", {}).get(service, {}).get("ports", [])
if policy == "none":
    raise SystemExit(0 if not ports else 1)
if policy != "private":
    raise SystemExit(2)
if len(ports) != 1:
    raise SystemExit(3)
port = ports[0]
if not isinstance(port, dict):
    raise SystemExit(4)
if str(port.get("target")) != "5432" or str(port.get("published")) != "5432":
    raise SystemExit(5)
if port.get("host_ip") != private_ip or port.get("protocol", "tcp") != "tcp":
    raise SystemExit(6)
' "$db_service" "$primary_tunnel_address" "$policy"
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
lock_file='/run/lock/lemtel-ha-primary-postgres-streaming.lock'

case "$age_recipient" in
  age1[0-9a-z]*) ;;
  *) fail invalid_standby_age_recipient ;;
esac
[ -d "$compose_dir" ] || fail compose_directory_missing
command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
command -v openssl >/dev/null 2>&1 || fail openssl_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
command -v python3 >/dev/null 2>&1 || fail python3_missing

# Lock before examining any shared file or database state; a concurrent run must never recreate db.
exec 9>"$lock_file"
flock -n 9 || fail concurrent_primary_streaming_prepare

systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 {print $2}')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
# Confirm the supplied public recipient before any database or compose mutation.
printf '' | age -r "$age_recipient" -o /dev/null || fail invalid_standby_age_recipient

docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
require_exact database_image "$(docker inspect --format '{{.Config.Image}}' "$db_container")" "$image_expected"
require_exact database_service "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$db_container")" "$db_service"
assert_no_runtime_bindings || fail unexpected_existing_database_port_binding
compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$db_container")"
[ -n "$compose_project" ] || fail compose_project_missing
compose_files_csv="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$db_container")"
[ -n "$compose_files_csv" ] || fail compose_files_missing
IFS=',' read -r -a compose_files <<< "$compose_files_csv"
for file in "${compose_files[@]}"; do [ -f "$file" ] || fail compose_file_missing; done

data_mount_before="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{printf "%s|%s" .Type .Source}}{{end}}{{end}}' "$db_container")"
[ -n "$data_mount_before" ] || fail database_data_mount_missing

base_compose_cmd=(docker compose --project-name "$compose_project")
for file in "${compose_files[@]}"; do base_compose_cmd+=(-f "$file"); done
validate_rendered_ports none "${base_compose_cmd[@]}" || fail base_compose_has_database_port

settings="$(query_database "SELECT current_setting('wal_level'), current_setting('max_wal_senders'), current_setting('max_replication_slots'), current_setting('hba_file'), (SELECT count(*) FROM pg_replication_slots), (SELECT count(*) FROM pg_stat_replication), COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), '')")"
IFS='|' read -r wal_level max_wal_senders max_replication_slots actual_hba_path slot_count sender_count slot_kind_before <<< "$settings"
case "$wal_level" in replica|logical) ;; *) fail unsuitable_wal_level ;; esac
[[ "$max_wal_senders" =~ ^[0-9]+$ ]] && [ "$max_wal_senders" -gt "$sender_count" ] || fail insufficient_wal_senders
case "$slot_kind_before" in ''|physical) ;; *) fail existing_replication_slot_not_physical ;; esac
if [ -z "$slot_kind_before" ]; then
  [[ "$max_replication_slots" =~ ^[0-9]+$ ]] && [ "$max_replication_slots" -gt "$slot_count" ] || fail insufficient_replication_slots
fi
require_exact active_hba_file "$actual_hba_path" /etc/postgresql/pg_hba.conf

role_state_before="$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")"
case "$role_state_before" in 'false|false'|'true|true') ;; *) fail unexpected_replication_role_state ;; esac

hba_target="$compose_dir/volumes/db/lemtel-ha-pg_hba.conf"
override_target="$compose_dir/docker-compose.lemtel-ha-replication.yml"
secret_dir='/etc/lemtel-ha/secrets'
secret_file="$secret_dir/postgres-replication.password"
envelope_file="$compose_dir/volumes/db/lemtel-ha-replication-password.age"
expected_hba_rule="host replication ${replication_role} ${standby_tunnel_address}/32 scram-sha-256"
sql_file="$(mktemp /root/lemtel-ha-replication.XXXXXX.sql)"
hba_tmp="$(mktemp "$compose_dir/volumes/db/.lemtel-ha-pg_hba.XXXXXX")"
override_tmp="$(mktemp "$compose_dir/.docker-compose.lemtel-ha-replication.XXXXXX")"

created_hba=false
created_override=false
created_secret=false
created_slot=false
created_role=false
created_envelope=false
database_recreate_started=false
completed=false
replication_compose_cmd=()

rollback() {
  local status=$?
  trap - EXIT
  set +e

  if [ "$status" -ne 0 ] && [ "$completed" = false ]; then
    printf 'primary_streaming_rollback_started=true\n' >&2

    # A compose failure can occur after old db removal; arm this before its invocation.
    if [ "$database_recreate_started" = true ]; then
      "${base_compose_cmd[@]}" up -d --no-deps --force-recreate "$db_service" >/dev/null 2>&1
      if wait_for_database "$db_container" && assert_no_runtime_bindings; then
        printf 'primary_streaming_rollback_base_topology_restored=true\n' >&2
      else
        printf 'primary_streaming_rollback_base_topology_restored=false\n' >&2
      fi
    fi

    # Only state created by this invocation is removed; existing operator-managed state is preserved.
    if wait_for_database "$db_container"; then
      if [ "$created_slot" = true ]; then
        docker exec "$db_container" sh -eu -c "export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT pg_drop_replication_slot('${replication_slot}') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '${replication_slot}' AND NOT active)\" >/dev/null" || true
      fi
      if [ "$created_role" = true ]; then
        docker exec "$db_container" sh -eu -c "export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"DROP ROLE IF EXISTS ${replication_role}\" >/dev/null" || true
      fi
    fi

    [ "$created_envelope" = true ] && rm -f "$envelope_file"
    [ "$created_secret" = true ] && rm -f "$secret_file"
    [ "$created_hba" = true ] && rm -f "$hba_target"
    [ "$created_override" = true ] && rm -f "$override_target"
    printf 'primary_streaming_rollback_attempted=true\n' >&2
  fi

  rm -f "$sql_file" "$hba_tmp" "$override_tmp"
  exit "$status"
}
trap rollback EXIT
umask 077
install -d -m 0700 "$secret_dir"

if [ "$role_state_before" = 'false|false' ] && [ -f "$secret_file" ]; then
  fail existing_secret_without_replication_role
fi
if [ "$role_state_before" = 'true|true' ] && [ ! -f "$secret_file" ]; then
  fail existing_replication_role_without_local_secret
fi

# Derive the future HBA from the active configuration and add exactly one private replication rule.
docker cp "${db_container}:${actual_hba_path}" "$hba_tmp"
[ -s "$hba_tmp" ] || fail hba_export_failed
hba_rule_count="$(grep -Fxc "$expected_hba_rule" "$hba_tmp" || true)"
case "$hba_rule_count" in
  0) printf '\n# Lemtel active-passive physical replication over WireGuard only\n%s\n' "$expected_hba_rule" >> "$hba_tmp" ;;
  1) ;;
  *) fail duplicate_replication_hba_rule ;;
esac
if [ -f "$hba_target" ]; then
  cmp -s "$hba_tmp" "$hba_target" || fail existing_hba_policy_mismatch
else
  install -m 0644 "$hba_tmp" "$hba_target"
  created_hba=true
fi

# Write the exact Compose override without exposing a runtime secret.
cat > "$override_tmp" <<EOF
services:
  ${db_service}:
    ports:
      - "${primary_tunnel_address}:5432:5432"
    volumes:
      - type: bind
        source: ./volumes/db/lemtel-ha-pg_hba.conf
        target: ${actual_hba_path}
        read_only: true
EOF
if [ -f "$override_target" ]; then
  cmp -s "$override_tmp" "$override_target" || fail existing_compose_override_mismatch
else
  install -m 0600 "$override_tmp" "$override_target"
  created_override=true
fi
replication_compose_cmd=("${base_compose_cmd[@]}" -f "$override_target")
validate_rendered_ports private "${replication_compose_cmd[@]}" || fail replication_compose_not_private

# The only planned interruption: recreate db with a port bound solely to the WireGuard address.
database_recreate_started=true
"${replication_compose_cmd[@]}" up -d --no-deps --force-recreate "$db_service"
wait_for_database "$db_container" || fail database_not_ready_after_recreate
require_exact database_data_mount_after_recreate "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{printf "%s|%s" .Type .Source}}{{end}}{{end}}' "$db_container")" "$data_mount_before"
assert_private_runtime_binding || fail private_database_binding_not_exact
post_hba_path="$(query_database "SELECT current_setting('hba_file')")"
require_exact active_hba_file_after_recreate "$post_hba_path" "$actual_hba_path"
[ "$(docker exec "$db_container" sh -eu -c "grep -Fxc '${expected_hba_rule}' '${actual_hba_path}'")" = 1 ] || fail replication_hba_rule_not_loaded

role_state_after_recreate="$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")"
if [ "$role_state_before" = 'true|true' ] && [ "$role_state_after_recreate" != 'true|true' ]; then
  fail replication_role_lost_after_recreate
fi
if [ "$role_state_before" = 'false|false' ] && [ "$role_state_after_recreate" != 'false|false' ]; then
  fail replication_role_changed_during_recreate
fi

slot_kind_after_recreate="$(query_database "SELECT COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), '')")"
if [ "$slot_kind_before" = physical ] && [ "$slot_kind_after_recreate" != physical ]; then
  fail replication_slot_lost_after_recreate
fi
if [ -z "$slot_kind_before" ] && [ -n "$slot_kind_after_recreate" ]; then
  fail replication_slot_changed_during_recreate
fi

if [ "$role_state_after_recreate" = 'false|false' ]; then
  openssl rand -hex 32 > "$secret_file"
  chmod 0600 "$secret_file"
  created_secret=true
  password="$(cat "$secret_file")"
  cat > "$sql_file" <<EOF
CREATE ROLE ${replication_role} WITH LOGIN REPLICATION PASSWORD '${password}';
EOF
  docker cp "$sql_file" "${db_container}:/tmp/lemtel-ha-replication.sql"
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/lemtel-ha-replication.sql >/dev/null; rm -f /tmp/lemtel-ha-replication.sql'
  unset password
  created_role=true
fi

if [ -z "$slot_kind_after_recreate" ]; then
  docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_create_physical_replication_slot('\''lemtel_do_standby'\'')" >/dev/null'
  created_slot=true
fi

require_exact replication_role_postcondition "$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")" 'true|true'
require_exact replication_slot_postcondition "$(query_database "SELECT COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), '')")" physical

age -r "$age_recipient" -o "$envelope_file" "$secret_file"
chmod 0600 "$envelope_file"
created_envelope=true

printf 'primary_streaming_prepare_format=lemtel_primary_streaming_prepare_v2\n'
printf 'declared_role=hostinger_primary\n'
printf 'single_run_lock_acquired=true\n'
printf 'database_container_recreated=true\n'
printf 'database_binding=%s:5432\n' "$primary_tunnel_address"
printf 'public_database_listener_enabled=false\n'
printf 'replication_role_created_or_verified=true\n'
printf 'physical_replication_slot_created_or_verified=true\n'
printf 'replication_secret_envelope_created=true\n'
printf 'rollback_on_failure_enabled=true\n'
printf 'plaintext_secret_replication=false\n'
printf 'storage_replication_started=false\n'
printf 'dns_failover_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'primary_streaming_prepare_status=complete\n'
completed=true
