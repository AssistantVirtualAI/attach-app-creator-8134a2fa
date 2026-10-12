#!/usr/bin/env bash
# Root-only preparation of the promoted DigitalOcean PostgreSQL writer for a
# Hostinger physical standby. It never promotes a server, starts a standby,
# changes traffic routing, exposes PostgreSQL publicly, or touches telephony.
set -euo pipefail

fail() {
  printf 'do_writer_streaming_prepare_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'prepare_do_writer_private_postgres_streaming' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

writer_tunnel_address='10.253.47.2'
standby_tunnel_address='10.253.47.1'
db_container='lemtel-postgres-standby'
image_expected='supabase/postgres:17.6.1.136'
replication_role='lemtel_ha_replication'
replication_slot='lemtel_hostinger_standby'
age_recipient="${LEMTEL_HA_STANDBY_AGE_RECIPIENT:-}"
secret_dir='/etc/lemtel-ha/secrets'
secret_file="$secret_dir/postgres-replication-hostinger.password"
envelope_dir='/home/lemtelops/.lemtel-ha'
envelope_file="$envelope_dir/replication-password-hostinger.age"
lock_file='/run/lock/lemtel-ha-do-writer-streaming-prepare.lock'
created_role=false
created_slot=false
created_secret=false
created_envelope=false
existing_envelope=false
hba_modified=false
completed=false

query_database() {
  local query="$1"
  docker exec -u postgres "$db_container" psql -X -At -F '|' -d postgres -c "$query"
}

validate_hba_path() {
  [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]]
}

rollback() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] && [ "$completed" = false ]; then
    if [ "$hba_modified" = true ]; then
      docker exec -u 0 "$db_container" sh -eu -c "test -f '${hba_backup}' && cat '${hba_backup}' > '${hba_path}' && rm -f '${hba_backup}'" >/dev/null 2>&1 || true
      docker exec -u postgres "$db_container" psql -X -At -d postgres -c 'SELECT pg_reload_conf()' >/dev/null 2>&1 || true
    fi
    if [ "$created_slot" = true ]; then
      docker exec -u postgres "$db_container" psql -X -At -d postgres -c "SELECT pg_drop_replication_slot('${replication_slot}') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '${replication_slot}' AND NOT active)" >/dev/null 2>&1 || true
    fi
    if [ "$created_role" = true ]; then
      docker exec -u postgres "$db_container" psql -X -At -d postgres -c "DROP ROLE IF EXISTS ${replication_role}" >/dev/null 2>&1 || true
    fi
    [ "$created_envelope" = true ] && rm -f "$envelope_file"
    [ "$created_secret" = true ] && rm -f "$secret_file"
    printf 'do_writer_streaming_prepare_rollback_attempted=true\n' >&2
  fi
  rm -f "${sql_file:-}"
  exit "$status"
}
trap rollback EXIT

case "$age_recipient" in age1[0-9a-z]*) ;; *) fail invalid_standby_age_recipient ;; esac
command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
command -v openssl >/dev/null 2>&1 || fail openssl_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
ip -brief address show lemtel-ha0 | grep -Fq "$writer_tunnel_address" || fail writer_tunnel_address_missing
printf '' | age -r "$age_recipient" -o /dev/null || fail invalid_standby_age_recipient
systemctl is-active --quiet lemtel-ha-do-postgres-wireguard-relay.service || fail private_postgres_relay_inactive
ss -H -ltn "sport = :5432" | awk '{print $4}' | grep -Fqx "${writer_tunnel_address}:5432" || fail private_postgres_relay_listener_missing

docker inspect "$db_container" >/dev/null 2>&1 || fail database_container_missing
[ "$(docker inspect --format '{{.Config.Image}}' "$db_container")" = "$image_expected" ] || fail unexpected_database_image
docker inspect --format '{{.State.Running}}' "$db_container" | grep -qx true || fail database_not_running
if docker port "$db_container" | grep -q .; then fail database_port_already_published; fi

exec 9>"$lock_file"
flock -n 9 || fail concurrent_writer_streaming_prepare

settings="$(query_database "SELECT pg_is_in_recovery(), current_setting('wal_level'), current_setting('max_wal_senders'), current_setting('max_replication_slots'), current_setting('hba_file'), (SELECT count(*) FROM pg_replication_slots), (SELECT count(*) FROM pg_stat_replication), COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), '')")"
IFS='|' read -r recovery wal_level max_wal_senders max_replication_slots hba_path slot_count sender_count slot_kind_before <<< "$settings"
[ "$recovery" = f ] || fail writer_in_recovery
case "$wal_level" in replica|logical) ;; *) fail unsuitable_wal_level ;; esac
[[ "$max_wal_senders" =~ ^[0-9]+$ ]] && [ "$max_wal_senders" -gt "$sender_count" ] || fail insufficient_wal_senders
case "$slot_kind_before" in ''|physical) ;; *) fail existing_replication_slot_not_physical ;; esac
if [ -z "$slot_kind_before" ]; then
  [[ "$max_replication_slots" =~ ^[0-9]+$ ]] && [ "$max_replication_slots" -gt "$slot_count" ] || fail insufficient_replication_slots
fi
validate_hba_path "$hba_path" || fail invalid_hba_path

role_state_before="$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")"
case "$role_state_before" in 'false|false'|'true|true') ;; *) fail unexpected_replication_role_state ;; esac

install -d -m 0700 "$secret_dir" "$envelope_dir"
if [ "$role_state_before" = 'false|false' ] && [ -f "$secret_file" ]; then fail existing_secret_without_replication_role; fi
if [ "$role_state_before" = 'true|true' ] && [ ! -f "$secret_file" ]; then fail existing_replication_role_without_local_secret; fi
if [ "$role_state_before" = 'true|true' ] && [ -f "$envelope_file" ]; then
  [ -s "$envelope_file" ] || fail existing_encrypted_replication_envelope_empty
  existing_envelope=true
fi

expected_hba_rule="host replication ${replication_role} ${standby_tunnel_address}/32 scram-sha-256"
hba_rule_count="$(docker exec -u 0 "$db_container" sh -eu -c "grep -Fxc '${expected_hba_rule}' '${hba_path}' || true")"
case "$hba_rule_count" in
  0)
    hba_backup="${hba_path}.lemtel-ha-hostinger.backup"
    docker exec -u 0 "$db_container" sh -eu -c "test ! -e '${hba_backup}'; cp '${hba_path}' '${hba_backup}'; printf '\n# Lemtel Hostinger private physical standby over WireGuard only\n${expected_hba_rule}\n' >> '${hba_path}'"
    hba_modified=true
    docker exec -u postgres "$db_container" psql -X -At -d postgres -c 'SELECT pg_reload_conf()' | grep -qx t || fail hba_reload_failed
    docker exec -u 0 "$db_container" sh -eu -c "grep -Fxc '${expected_hba_rule}' '${hba_path}'" | grep -qx 1 || fail replication_hba_rule_not_loaded
    ;;
  1) hba_backup='' ;;
  *) fail duplicate_replication_hba_rule ;;
esac

if [ "$role_state_before" = 'false|false' ]; then
  umask 077
  openssl rand -hex 32 > "$secret_file"
  chmod 0600 "$secret_file"
  created_secret=true
  password="$(cat "$secret_file")"
  sql_file="$(mktemp /root/lemtel-ha-hostinger-replication.XXXXXX.sql)"
  chmod 0600 "$sql_file"
  printf "CREATE ROLE %s WITH LOGIN REPLICATION PASSWORD '%s';\n" "$replication_role" "$password" > "$sql_file"
  docker cp "$sql_file" "${db_container}:/tmp/lemtel-ha-hostinger-replication.sql"
  docker exec -u 0 "$db_container" sh -eu -c 'chown postgres:postgres /tmp/lemtel-ha-hostinger-replication.sql; chmod 0600 /tmp/lemtel-ha-hostinger-replication.sql'
  docker exec -u postgres "$db_container" sh -eu -c 'psql -X -v ON_ERROR_STOP=1 -d postgres -f /tmp/lemtel-ha-hostinger-replication.sql >/dev/null; rm -f /tmp/lemtel-ha-hostinger-replication.sql'
  unset password
  created_role=true
fi

if [ -z "$slot_kind_before" ]; then
  docker exec -u postgres "$db_container" psql -X -At -d postgres -c "SELECT pg_create_physical_replication_slot('${replication_slot}')" >/dev/null
  created_slot=true
fi

[ "$(query_database "SELECT COALESCE((SELECT rolcanlogin::text || '|' || rolreplication::text FROM pg_roles WHERE rolname = '${replication_role}'), 'false|false')")" = 'true|true' ] || fail replication_role_postcondition
[ "$(query_database "SELECT COALESCE((SELECT slot_type FROM pg_replication_slots WHERE slot_name = '${replication_slot}'), '')")" = physical ] || fail replication_slot_postcondition
if [ "$existing_envelope" = false ]; then
  age -r "$age_recipient" -o "$envelope_file" "$secret_file"
  chmod 0600 "$envelope_file"
  chown lemtelops:lemtelops "$envelope_file"
  created_envelope=true
fi
[ "$hba_modified" = true ] && docker exec -u 0 "$db_container" rm -f "$hba_backup"

printf 'do_writer_streaming_prepare_format=lemtel_do_writer_streaming_prepare_v1\n'
printf 'declared_role=digitalocean_writer\n'
printf 'wireguard_handshake_verified=true\n'
printf 'database_private_before=true\n'
printf 'writer_in_recovery=false\n'
printf 'replication_hba_rule_private_only=true\n'
printf 'replication_role_created_or_verified=true\n'
printf 'physical_replication_slot_created_or_verified=true\n'
printf 'replication_secret_envelope_created=true\n'
printf 'replication_secret_envelope_reused=%s\n' "$existing_envelope"
printf 'rollback_on_failure_enabled=true\n'
printf 'plaintext_secret_replication=false\n'
printf 'database_public_listener_enabled=false\n'
printf 'storage_replication_started=false\n'
printf 'runtime_changed=false\n'
printf 'dns_changed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'do_writer_streaming_prepare_status=complete\n'
completed=true
