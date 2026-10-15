#!/usr/bin/env bash
# Transactionally adds a content-free L7 readiness route to the existing DO writer Caddyfile.
set -euo pipefail
fail() { printf 'do_writer_l7_route_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'deploy_digitalocean_writer_l7_ready_route' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role
bundle="${LEMTEL_L7_READY_BUNDLE:-/home/lemtelops/lemtel-l7-ready-deployment}"
refresh_source="$bundle/lemtel-ha-do-writer-lb-ready-refresh.sh"
timer_source="$bundle/lemtel-ha-do-writer-lb-ready-timer-enable.sh"
manifest="$bundle/manifest.sha256"
canonical_host='lemtel.assistantvirtualai.com'
route_marker='# LEMTEL_LOAD_BALANCER_READY_V1'
caddy_container='supabase-caddy'
lock_file='/var/lock/lemtel-ha-do-writer-l7-route.lock'
for required in "$refresh_source" "$timer_source" "$manifest"; do [ -s "$required" ] || fail bundle_file_missing; done
verify() { local p="$1" expected actual; expected="$(awk -v name="$(basename "$p")" '$2 == name {print $1}' "$manifest")"; actual="$(sha256sum "$p" | awk '{print $1}')"; [ -n "$expected" ] && [ "$expected" = "$actual" ] || fail manifest_digest_mismatch; }
verify "$refresh_source"; verify "$timer_source"
docker inspect "$caddy_container" >/dev/null 2>&1 || fail caddy_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_not_running
caddy_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
[ -n "$caddy_mount" ] || fail caddy_mount_missing
caddyfile="$caddy_mount/Caddyfile"
[ -f "$caddyfile" ] || fail caddyfile_missing
site_line="$(awk -v canonical_host="$canonical_host" '
  /^[[:space:]]*#/ { next }
  index($0, canonical_host) && $0 ~ /[{][[:space:]]*$/ {
    candidate = $0
    matches += 1
    if (matches == 1) print candidate
  }
  END { if (matches != 1) exit 1 }
' "$caddyfile")" || fail canonical_site_unexpected
[ -n "$site_line" ] || fail canonical_site_unexpected
route_marker_count="$(grep -Fc "$route_marker" "$caddyfile" || true)"
case "$route_marker_count" in
  0) route_state='installed' ;;
  1)
    grep -Fq '@lemtel_load_balancer_ready path /lemtel-lb-ready' "$caddyfile" || fail existing_route_invalid
    grep -Fq 'rewrite * /lemtel-lb-ready' "$caddyfile" || fail existing_route_invalid
    route_state='already_present'
    ;;
  *) fail route_marker_ambiguous ;;
esac
exec 9>"$lock_file"; flock -n 9 || fail concurrent_deploy
backup_dir="/var/lib/lemtel-ha/l7-ready/backups/$(date -u +%Y%m%dT%H%M%SZ)"; install -d -o root -g root -m 0700 "$backup_dir"
backup="$backup_dir/Caddyfile"; candidate="$(mktemp "${caddyfile}.l7-ready.XXXXXX")"; temporary="$(mktemp "${caddyfile}.live.XXXXXX")"; replaced=false
rollback() { if [ "$replaced" = true ]; then cp -- "$backup" "$caddyfile"; docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true; fi; rm -f "$candidate" "$temporary"; }
trap rollback ERR INT TERM
if [ "$route_state" = installed ]; then
  awk -v site="$site_line" -v marker="$route_marker" '$0 == site { print; print "  " marker; print "  @lemtel_load_balancer_ready path /lemtel-lb-ready"; print "  handle @lemtel_load_balancer_ready {"; print "    root * /etc/caddy"; print "    rewrite * /lemtel-lb-ready"; print "    file_server"; print "  }"; next } { print }' "$caddyfile" > "$candidate"
  docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null || fail caddy_candidate_invalid
  cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
  cp -- "$candidate" "$temporary"; chmod --reference="$caddyfile" "$temporary"; mv -f "$temporary" "$caddyfile"; replaced=true
  docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_live_invalid
  docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_reload_failed
fi
LEMTEL_HA_EXECUTE=enable_digitalocean_writer_l7_ready_timer LEMTEL_HA_ROLE=digitalocean_promoted_writer LEMTEL_L7_READY_SOURCE="$refresh_source" bash "$timer_source"
replaced=false; trap - ERR INT TERM; rm -f "$candidate" "$temporary"
printf 'do_writer_l7_route_deploy_format=lemtel_do_writer_l7_route_v1\n'
printf 'writer=digitalocean_promoted_writer\n'
printf 'route_state=%s\n' "$route_state"
printf 'route_deployed=true\n'
printf 'marker_timer_enabled=true\n'
printf 'dns_change_executed=false\n'
printf 'cloudflare_routing_changed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_l7_route_deploy_status=complete\n'
