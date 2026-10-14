#!/usr/bin/env bash
# Root-only, read-only Hostinger standby parity evidence. It never starts the dormant runtime.
set -euo pipefail
fail() { printf 'hostinger_runtime_parity_preflight_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'preflight_hostinger_standby_runtime_parity' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

artifact_dir='/var/lib/lemtel-ha/artifacts/hostinger-received'
current_digest_file="$artifact_dir/current.sha256"
runtime_stage='/opt/lemtel-ha/runtime-stage'
postgres_container='lemtel-postgres-standby'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
command -v wg >/dev/null 2>&1 || fail wireguard_missing
command -v ss >/dev/null 2>&1 || fail ss_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

[ -s "$current_digest_file" ] || fail artifact_digest_missing
artifact_digest="$(tr -d '[:space:]' < "$current_digest_file")"
[[ "$artifact_digest" =~ ^[a-f0-9]{64}$ ]] || fail artifact_digest_invalid
artifact_file="$artifact_dir/$artifact_digest.tgz"
[ -f "$artifact_file" ] || fail artifact_archive_missing
[ "$(sha256sum "$artifact_file" | awk '{print $1}')" = "$artifact_digest" ] || fail artifact_digest_mismatch

for required in .env docker-compose.yml docker-compose.caddy.yml docker-compose.lemtel-private.yml docker-compose.lemtel-db-init.yml; do
  [ -f "$runtime_stage/$required" ] || fail runtime_stage_missing
done
[ -d "$runtime_stage/volumes/functions" ] || fail runtime_functions_missing
[ -d "$runtime_stage/volumes/proxy/caddy" ] || fail runtime_caddy_missing
(
  cd "$runtime_stage"
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml config >/dev/null
) || fail runtime_compose_invalid

while IFS= read -r runtime_container; do
  [ -z "$runtime_container" ] && continue
  [ "$runtime_container" = "$postgres_container" ] || fail standby_runtime_running
done < <(docker ps --filter label=com.docker.compose.project=lemtel-ha-standby --format '{{.Names}}')
docker inspect "$postgres_container" >/dev/null 2>&1 || fail standby_postgres_missing
[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true ] || fail standby_postgres_not_running
[ -z "$(docker port "$postgres_container" 2>/dev/null || true)" ] || fail standby_postgres_port_published
ss -H -ltn 'sport = :5432' | grep -q . && fail host_postgres_listener_detected

docker exec -u postgres "$postgres_container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()' | grep -qx t || fail standby_not_in_recovery
receiver="$(docker exec -u postgres "$postgres_container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')"
[ "$receiver" = streaming ] || fail wal_receiver_not_streaming

printf 'hostinger_runtime_parity_preflight_format=lemtel_hostinger_runtime_parity_v1\n'
printf 'standby=hostinger_private_standby\n'
printf 'artifact_digest_verified=true\n'
printf 'runtime_stage_compose_verified=true\n'
printf 'runtime_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'standby_in_recovery=true\n'
printf 'wal_receiver_status=streaming\n'
printf 'host_postgres_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_runtime_parity_preflight_status=complete\n'
