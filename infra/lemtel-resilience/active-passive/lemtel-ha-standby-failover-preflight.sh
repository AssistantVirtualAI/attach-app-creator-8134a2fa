#!/usr/bin/env bash
# Root-only, non-mutating evidence collection for a later manually approved controlled failover.
set -euo pipefail

fail() {
  printf 'standby_failover_preflight_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'preflight_controlled_standby_failover' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

primary_tunnel_address='10.253.47.1'
container='lemtel-postgres-standby'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v wg >/dev/null 2>&1 || fail wireguard_missing
command -v timeout >/dev/null 2>&1 || fail timeout_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 {print $2}')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

docker inspect "$container" >/dev/null 2>&1 || fail standby_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail standby_container_not_running
if docker port "$container" | grep -q .; then fail standby_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx t || fail standby_not_in_recovery
receiver="$(docker exec -u postgres "$container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')"
[ "$receiver" = streaming ] || fail wal_receiver_not_streaming

if timeout 3 bash -c "</dev/tcp/${primary_tunnel_address}/5432" 2>/dev/null; then
  primary_writer_reachable=true
else
  primary_writer_reachable=false
fi

printf 'standby_failover_preflight_format=lemtel_standby_failover_preflight_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'standby_in_recovery=true\n'
printf 'wal_receiver_status=streaming\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'primary_writer_reachable=%s\n' "$primary_writer_reachable"
printf 'fencing_verified=false\n'
printf 'promotion_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_failover_enabled=false\n'
printf 'storage_runtime_started=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'standby_failover_preflight_status=complete\n'
