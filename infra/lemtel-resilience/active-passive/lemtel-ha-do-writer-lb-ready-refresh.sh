#!/usr/bin/env bash
# Publishes a content-free Caddy marker only while the DO writer passes local checks.
# No routing, provider action, promotion, database mutation or telephony action is performed.
set -euo pipefail

fail() {
  clear_marker || true
  printf 'do_writer_l7_ready_status=degraded\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'refresh_digitalocean_writer_l7_ready' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role

caddy_container='supabase-caddy'
storage_timer='lemtel-ha-do-writer-storage-sync.timer'
resolve_runtime_container() {
  local image_pattern="$1"
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' -v pattern="$image_pattern" '$2 ~ pattern { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
db_container="$(resolve_runtime_container '(^|/)postgres(:|$)|supabase/postgres(:|$)' || true)"
auth_container="$(resolve_runtime_container '(^|/)gotrue(:|$)|supabase/gotrue(:|$)' || true)"
[ -n "$db_container" ] || fail database_container_unresolved
[ -n "$auth_container" ] || fail auth_container_unresolved
storage_attestation='/var/lib/lemtel-ha/storage-sync-manifests/last-success'
max_storage_freshness_seconds=900
marker_name='lemtel-lb-ready'
marker_path=''

clear_marker() {
  local mount
  mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container" 2>/dev/null || true)"
  [ -n "$mount" ] && rm -f -- "$mount/$marker_name"
  [ -n "$marker_path" ] && rm -f -- "$marker_path"
}

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v curl >/dev/null 2>&1 || fail curl_missing
command -v wg >/dev/null 2>&1 || fail wireguard_missing
for container in "$caddy_container" "$db_container" "$auth_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done

caddy_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
[ -n "$caddy_mount" ] || fail caddy_mount_missing
marker_path="$caddy_mount/$marker_name"

systemctl is-active --quiet "$storage_timer" || fail storage_timer_inactive
systemctl is-enabled --quiet "$storage_timer" || fail storage_timer_disabled
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
handshake="$(wg show lemtel-ha0 latest-handshakes | awk 'NR == 1 { print $2 }')"
[ "${handshake:-0}" -gt 0 ] || fail wireguard_handshake_missing

writer_state="$(docker exec "$db_container" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery()::text, (SELECT count(*) FROM pg_stat_replication WHERE state = '\''streaming'\'')"' 2>/dev/null || true)"
IFS='|' read -r in_recovery streaming_count <<< "$writer_state"
[ "$in_recovery" = false ] || fail database_not_writer
[[ "$streaming_count" =~ ^[0-9]+$ ]] && [ "$streaming_count" -ge 1 ] || fail database_streaming_absent

[ -s "$storage_attestation" ] || fail storage_attestation_missing
storage_age_seconds="$(( $(date +%s) - $(stat -c %Y "$storage_attestation") ))"
[ "$storage_age_seconds" -ge 0 ] && [ "$storage_age_seconds" -le "$max_storage_freshness_seconds" ] || fail storage_attestation_stale

auth_url="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$auth_container" | sed -n 's/^API_EXTERNAL_URL=//p' | sed -n '1p')"
case "$auth_url" in https://*) ;; *) fail auth_external_url_invalid ;; esac
auth_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 15 "$auth_url/auth/v1/health" || true)"
case "$auth_status" in 200|204|401|403) ;; *) fail auth_route_unreachable ;; esac

tmp="$(mktemp "$caddy_mount/.${marker_name}.XXXXXX")"
printf 'ready\n' > "$tmp"
chmod 0644 "$tmp"
mv -f -- "$tmp" "$marker_path"

printf 'do_writer_l7_ready_format=lemtel_do_writer_l7_ready_v1\n'
printf 'writer=digitalocean_promoted_writer\n'
printf 'marker_written=true\n'
printf 'response_body=content_free_ready\n'
printf 'dns_change_executed=false\n'
printf 'cloudflare_routing_changed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_l7_ready_status=complete\n'
