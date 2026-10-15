#!/usr/bin/env bash
# Root-only application of the exact, no-access-log Caddy route for private Lemtel traffic ingress.
# It only routes one HMAC-enforced Edge Function and never enables any collector.
set -euo pipefail
fail() { printf 'traffic_ingress_route_apply_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_TRAFFIC_ROUTE_EXECUTE:-}" = apply_verified_traffic_ingress_route ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
[ "${LEMTEL_TRAFFIC_ROUTE_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ] || fail fresh_backup_attestation_required
[ "${LEMTEL_TRAFFIC_ROUTE_REVIEW_APPROVAL:-}" = REVIEWED_DO_WRITER_TRAFFIC_ROUTE ] || fail review_approval_required
[ "${LEMTEL_TRAFFIC_ROUTE_SNAPSHOT_ATTESTATION:-}" = DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED ] || fail snapshot_restore_attestation_required
[ "${LEMTEL_TRAFFIC_EDGE_LOG_ATTESTATION:-}" = EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED ] || fail ingress_log_attestation_required

canonical_host='lemtel.assistantvirtualai.com'
route_marker='# LEMTEL_TRAFFIC_INGRESS_V1'
caddy='supabase-caddy'
lock_file='/var/lock/lemtel-traffic-ingress-route.lock'

docker inspect "$caddy" >/dev/null 2>&1 || fail caddy_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy")" = true ] || fail caddy_not_running
caddy_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy")"
[ -n "$caddy_mount" ] || fail caddy_mount_missing
caddyfile="$caddy_mount/Caddyfile"
[ -f "$caddyfile" ] || fail caddyfile_missing
site_line="$(awk -v host="$canonical_host" '
  /^[[:space:]]*#/ { next }
  index($0, host) && $0 ~ /[{][[:space:]]*$/ { matches += 1; if (matches == 1) print }
  END { if (matches != 1) exit 1 }
' "$caddyfile")" || fail canonical_site_unexpected
[ -n "$site_line" ] || fail canonical_site_unexpected

# Obtain, but do not print, the existing internal Edge upstream used by the generic functions route.
functions_upstream="$(awk '
  /^[[:space:]]*(handle|handle_path)[[:space:]].*\/functions/ { active=1; next }
  active && /^[[:space:]]*reverse_proxy[[:space:]]+/ { print $2; exit }
  active && /^[[:space:]]*}[[:space:]]*$/ { active=0 }
' "$caddyfile")"
[[ "$functions_upstream" =~ ^[A-Za-z0-9._-]+:[0-9]+$ ]] || fail functions_proxy_upstream_unresolved
marker_count="$(grep -Fc "$route_marker" "$caddyfile" || true)"
case "$marker_count" in
  0) route_state=installed ;;
  1)
    awk -v marker="$route_marker" '
      index($0, marker) { inside=1; next }
      inside && /@lemtel_traffic_ingest path \/functions\/v1\/lemtel-traffic-ingest/ { exact_path=1 }
      inside && /^[[:space:]]*log_skip[[:space:]]*$/ { no_log=1 }
      inside && /^[[:space:]]*}[[:space:]]*$/ { exit }
      END { exit !(exact_path && no_log) }
    ' "$caddyfile" || fail existing_route_invalid
    route_state=already_present
    ;;
  *) fail route_marker_ambiguous ;;
esac

exec 9>"$lock_file"
flock -n 9 || fail concurrent_route_apply
backup_dir="/var/lib/lemtel-ha/traffic-observability/caddy-backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup_dir"
candidate="$(mktemp "${caddyfile}.traffic.XXXXXX")"
temporary="$(mktemp "${caddyfile}.live.XXXXXX")"
replaced=false
rollback() {
  code=$?
  if [ "$replaced" = true ]; then
    cp -- "$backup_dir/Caddyfile" "$caddyfile" || true
    docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  fi
  rm -f "$candidate" "$temporary"
  exit "$code"
}
trap rollback ERR INT TERM
if [ "$route_state" = installed ]; then
  awk -v site="$site_line" -v marker="$route_marker" -v upstream="$functions_upstream" '
    $0 == site {
      print
      print "  " marker
      print "  @lemtel_traffic_ingest path /functions/v1/lemtel-traffic-ingest"
      print "  handle @lemtel_traffic_ingest {"
      print "    log_skip"
      print "    reverse_proxy " upstream
      print "  }"
      next
    }
    { print }
  ' "$caddyfile" > "$candidate"
  docker exec -i "$caddy" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null || fail caddy_candidate_invalid
  cp --preserve=mode,ownership,timestamps "$caddyfile" "$backup_dir/Caddyfile"
  cp -- "$candidate" "$temporary"
  chmod --reference="$caddyfile" "$temporary"
  mv -f "$temporary" "$caddyfile"
  replaced=true
  docker exec "$caddy" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_live_invalid
  docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_reload_failed
fi
replaced=false
trap - ERR INT TERM
rm -f "$candidate" "$temporary"
printf 'traffic_ingress_route_apply_format=lemtel_traffic_ingress_route_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'edge_runtime=direct_caddy_to_edge\n'
printf 'route_state=%s\n' "$route_state"
printf 'route_specific_hmac_ingress=true\n'
printf 'gateway_jwt_bypass=not_applicable_no_gateway\n'
printf 'access_logging_for_ingress=false\n'
printf 'traffic_collectors_enabled=false\n'
printf 'database_mutation=false\n'
printf 'dns_change_executed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'traffic_ingress_route_apply_status=complete\n'
