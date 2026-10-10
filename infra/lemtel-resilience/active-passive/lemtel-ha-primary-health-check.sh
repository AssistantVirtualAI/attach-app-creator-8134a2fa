#!/usr/bin/env bash
# Root-only primary health monitor: HTTPS/Auth reachability, WAL streaming and Storage freshness.
set -euo pipefail

state_dir='/var/lib/lemtel-ha/health'
state_file="$state_dir/primary-health.status"

write_state() {
  local status="$1" reason="$2"
  install -d -m 0700 "$state_dir"
  local tmp
  tmp="$(mktemp "$state_dir/.primary-health.XXXXXX")"
  {
    printf 'checked_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=%s\n' "$status"
    printf 'reason=%s\n' "$reason"
  } > "$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$state_file"
}

fail() {
  write_state degraded "$1"
  printf 'primary_health_status=degraded\n' >&2
  printf 'primary_health_reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'check_private_active_passive_health' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

primary_tunnel_address='10.253.47.1'
db_container='supabase-db'
auth_container='supabase-auth'
caddy_container='supabase-caddy'
storage_timer='lemtel-ha-storage-sync.timer'
storage_log='/var/lib/lemtel-ha/storage-sync-manifests/last-rsync.log'
max_storage_freshness_seconds=900

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v curl >/dev/null 2>&1 || fail curl_missing
command -v wg >/dev/null 2>&1 || fail wireguard_missing
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
systemctl is-active --quiet "$storage_timer" || fail storage_timer_inactive
systemctl is-enabled --quiet "$storage_timer" || fail storage_timer_disabled
ip -brief address show lemtel-ha0 | grep -q "$primary_tunnel_address" || fail primary_tunnel_address_missing
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

for container in "$db_container" "$auth_container" "$caddy_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail "container_missing_${container}"
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail "container_not_running_${container}"
done

query_database() {
  local query="$1"
  docker exec "$db_container" sh -eu -c "export PSQLRC=/dev/null; psql -X -At -F '|' -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"${query}\""
}

db_state="$(query_database "SELECT pg_is_in_recovery()::text, (SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming'), COALESCE((SELECT max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn))::bigint FROM pg_stat_replication WHERE state = 'streaming'), 0)")" || fail postgres_query_failed
IFS='|' read -r primary_in_recovery streaming_count max_lag_bytes <<< "$db_state"
[ "$primary_in_recovery" = false ] || fail primary_not_writer
[[ "$streaming_count" =~ ^[0-9]+$ ]] && [ "$streaming_count" -ge 1 ] || fail postgres_streaming_absent
[[ "$max_lag_bytes" =~ ^[0-9]+$ ]] || fail postgres_lag_unreadable

[ -f "$storage_log" ] || fail storage_sync_log_missing
storage_last_sync_epoch="$(stat -c %Y "$storage_log")"
storage_sync_age_seconds="$(( $(date +%s) - storage_last_sync_epoch ))"
[ "$storage_sync_age_seconds" -ge 0 ] || fail storage_sync_clock_invalid
[ "$storage_sync_age_seconds" -le "$max_storage_freshness_seconds" ] || fail storage_sync_stale

auth_url="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$auth_container" | sed -n 's/^API_EXTERNAL_URL=//p' | sed -n '1p')"
case "$auth_url" in
  https://*) auth_scheme=https ;;
  *) fail auth_external_url_not_https ;;
esac
auth_http_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 15 "$auth_url/auth/v1/health" || true)"
case "$auth_http_status" in
  200|204|401|403) ;;
  *) fail auth_route_unreachable ;;
esac

write_state healthy complete
printf 'primary_health_format=lemtel_primary_health_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'wireguard_handshake_verified=true\n'
printf 'primary_auth_https_reachable=true\n'
printf 'primary_auth_http_status=%s\n' "$auth_http_status"
printf 'primary_postgres_writer=true\n'
printf 'postgres_streaming_replicas=%s\n' "$streaming_count"
printf 'postgres_max_lag_bytes=%s\n' "$max_lag_bytes"
printf 'storage_timer_active=true\n'
printf 'storage_sync_age_seconds=%s\n' "$storage_sync_age_seconds"
printf 'storage_freshness_within_policy=true\n'
printf 'standby_storage_runtime_started=false\n'
printf 'public_storage_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'dns_failover_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'primary_health_status=healthy\n'
