#!/usr/bin/env bash
# Root-only recovery validation remediation for an already initialized, contained PostgreSQL standby.
set -euo pipefail

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'standby_recovery_remediate_status=root_required\n' >&2
    exit 1
  fi
}

fail() {
  printf 'standby_recovery_remediate_status=%s\n' "$1" >&2
  exit 1
}

require_root
[ "${LEMTEL_HA_EXECUTE:-}" = 'remediate_private_postgres_standby_recovery' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

image='supabase/postgres:17.6.1.136'
base_dir="${LEMTEL_HA_STANDBY_BASE_DIR:-/opt/lemtel-ha}"
data_dir="$base_dir/postgres/data"
container='lemtel-postgres-standby'

command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 {print $2}')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing
docker image inspect "$image" >/dev/null 2>&1 || fail expected_postgres_image_missing
docker inspect "$container" >/dev/null 2>&1 || fail standby_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail standby_container_must_be_stopped
[ -d "$data_dir" ] || fail standby_data_directory_missing
[ -f "$data_dir/standby.signal" ] || fail standby_signal_missing
[ -f "$data_dir/postgresql.auto.conf" ] || fail standby_auto_conf_missing
[ -f "$data_dir/lemtel-ha-replication.pgpass" ] || fail standby_local_passfile_missing

data_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' "$container")"
[ "$data_mount" = "$data_dir" ] || fail unexpected_data_mount
# Docker lists the image's internal 5432/tcp declaration even when no host port is
# published. `docker port` emits output only for a real host binding.
if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

# The base backup inherits the primary's setting. A standby alone enables read-only recovery access.
sed -i '/^[[:space:]]*hot_standby[[:space:]]*=/d' "$data_dir/postgresql.auto.conf"
printf '%s\n' 'hot_standby = on' >> "$data_dir/postgresql.auto.conf"
grep -Fqx 'hot_standby = on' "$data_dir/postgresql.auto.conf" || fail hot_standby_enable_failed

standby_started=false
cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$standby_started" = true ]; then
    docker stop --time 15 "$container" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT

docker start "$container" >/dev/null
standby_started=true
for _ in $(seq 1 45); do
  if docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true \
    && docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 2
done

docker inspect --format '{{.State.Running}}' "$container" | grep -qx true || fail standby_container_not_running
docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx true || fail standby_not_in_recovery
if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi
receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')"
[ "$receiver" = streaming ] || fail wal_receiver_not_streaming

printf 'standby_recovery_remediate_format=lemtel_standby_recovery_remediate_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'standby_database_container=%s\n' "$container"
printf 'standby_in_recovery=true\n'
printf 'wal_receiver_status=streaming\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'storage_replication_started=false\n'
printf 'dns_failover_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'standby_recovery_remediate_status=complete\n'
