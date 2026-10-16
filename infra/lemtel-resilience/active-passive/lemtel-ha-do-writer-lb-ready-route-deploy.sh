#!/usr/bin/env bash
# Transactionally installs the exact public L7 readiness route from a digest-verified local bundle.
# No routing/provider/promotion/fencing/database/telephony action is performed.
set -euo pipefail

fail() { printf 'do_writer_l7_route_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'deploy_digitalocean_writer_l7_ready_route' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_promoted_writer' ] || fail invalid_role

archive="${LEMTEL_L7_READY_ARCHIVE:-}"
digest_file="${LEMTEL_L7_READY_ARCHIVE_DIGESTS:-}"
bundle="${LEMTEL_L7_READY_BUNDLE:-}"
[ -n "$archive" ] && [ -f "$archive" ] && [ ! -L "$archive" ] || fail archive_missing
[ -n "$digest_file" ] && [ -f "$digest_file" ] && [ ! -L "$digest_file" ] || fail archive_digest_missing
[ -n "$bundle" ] && [ -d "$bundle" ] && [ ! -L "$bundle" ] || fail bundle_missing
archive_name="$(basename -- "$archive")"
[ "$archive_name" = 'lemtel-l7-ready-deployment.tar.gz' ] || fail archive_name_invalid

refresh_source="$bundle/lemtel-ha-do-writer-lb-ready-refresh.sh"
timer_source="$bundle/lemtel-ha-do-writer-lb-ready-timer-enable.sh"
self_source="$bundle/lemtel-ha-do-writer-lb-ready-route-deploy.sh"
manifest="$bundle/manifest.sha256"
bundle_sources=(
  lemtel-ha-do-writer-lb-ready-refresh.sh
  lemtel-ha-do-writer-lb-ready-route-deploy.sh
  lemtel-ha-do-writer-lb-ready-timer-enable.sh
)
expected_archive_listing=$'lemtel-ha-do-writer-lb-ready-refresh.sh\nlemtel-ha-do-writer-lb-ready-route-deploy.sh\nlemtel-ha-do-writer-lb-ready-timer-enable.sh\nmanifest.sha256'

verify_bundle() {
  command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
  command -v tar >/dev/null 2>&1 || fail tar_missing
  [ "$(wc -l < "$digest_file" | tr -d '[:space:]')" = 1 ] || fail archive_digest_ambiguous
  expected_digest="$(awk -v name="$archive_name" 'NF == 2 && $2 == name && $1 ~ /^[0-9a-f]{64}$/ { print $1 }' "$digest_file")"
  [ "${#expected_digest}" -eq 64 ] || fail archive_digest_invalid
  actual_digest="$(sha256sum "$archive" | awk '{print $1}')"
  [ "$actual_digest" = "$expected_digest" ] || fail archive_digest_mismatch
  actual_archive_listing="$(tar -tzf "$archive")" || fail archive_unreadable
  [ "$actual_archive_listing" = "$expected_archive_listing" ] || fail archive_layout_invalid
  [ "$(readlink -f -- "$0")" = "$(readlink -f -- "$self_source")" ] || fail bundle_entrypoint_invalid
  for file in "${bundle_sources[@]}"; do
    [ -f "$bundle/$file" ] && [ ! -L "$bundle/$file" ] || fail bundle_file_missing
  done
  [ -f "$manifest" ] && [ ! -L "$manifest" ] || fail bundle_file_missing
  [ "$(wc -l < "$manifest" | tr -d '[:space:]')" = "${#bundle_sources[@]}" ] || fail manifest_ambiguous
  expected_manifest_listing="$(printf '%s\n' "${bundle_sources[@]}")"
  actual_manifest_listing="$(awk 'NF == 2 && $1 ~ /^[0-9a-f]{64}$/ { print $2 }' "$manifest")"
  [ "$actual_manifest_listing" = "$expected_manifest_listing" ] || fail manifest_layout_invalid
  (cd "$bundle" && sha256sum -c --status "$(basename -- "$manifest")") || fail manifest_digest_mismatch
}
verify_bundle

canonical_host='lemtel.assistantvirtualai.com'
public_l7_url="https://${canonical_host}/lemtel-lb-ready"
route_marker='# LEMTEL_LOAD_BALANCER_READY_V1'
caddy_container='supabase-caddy'
lock_file='/var/lock/lemtel-ha-do-writer-l7-route.lock'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v curl >/dev/null 2>&1 || fail curl_missing
command -v python3 >/dev/null 2>&1 || fail python3_missing
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
    grep -Fq 'header Content-Type application/json' "$caddyfile" || fail existing_route_invalid
    route_state='already_present'
    ;;
  *) fail route_marker_ambiguous ;;
esac

attest_l7_response() {
  local response metadata http_code content_type
  response="$(mktemp)"
  response_file="$response"
  metadata="$(curl --silent --show-error --output "$response" --write-out '%{http_code}\n%{content_type}' \
    --connect-timeout 5 --max-time 15 --proto '=https' --max-redirs 0 "$public_l7_url")" || return 1
  IFS=$'\n' read -r http_code content_type <<< "$metadata"
  [ "$http_code" = 200 ] || return 1
  [ "$content_type" = application/json ] || return 1
  python3 - "$response" <<'PY'
import json
import sys
import time

try:
    def exact_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate_key')
            result[key] = value
        return result

    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        body = json.load(handle, object_pairs_hook=exact_object)
    now = int(time.time())
    expected_keys = {'format', 'writer_role', 'definitive', 'observed_at', 'status'}
    if type(body) is not dict or set(body) != expected_keys:
        raise ValueError('schema')
    if body['format'] != 'lemtel_do_writer_l7_ready_v1':
        raise ValueError('format')
    if body['writer_role'] != 'do_writer' or body['definitive'] is not True:
        raise ValueError('writer')
    if type(body['observed_at']) is not int or not now - 120 <= body['observed_at'] <= now + 15:
        raise ValueError('observed_at')
    if body['status'] != 'healthy':
        raise ValueError('status')
except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
    sys.exit(1)
PY
}

exec 9>"$lock_file"
flock -n 9 || fail concurrent_deploy
backup_root='/var/lib/lemtel-ha/l7-ready/backups'
install -d -o root -g root -m 0700 "$backup_root"
backup_dir="$(mktemp -d "$backup_root/caddy.XXXXXX")"
backup="$backup_dir/Caddyfile"
cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
candidate=''
temporary=''
response_file=''
replaced=false
success=false
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$success" != true ] && [ "$replaced" = true ]; then
    restore="$(mktemp "${caddyfile}.l7-ready.rollback.XXXXXX")" || restore=''
    if [ -n "$restore" ]; then
      cp --preserve=mode,ownership,timestamps -- "$backup" "$restore" 2>/dev/null || true
      chmod --reference="$caddyfile" "$restore" 2>/dev/null || true
      mv -f -- "$restore" "$caddyfile" 2>/dev/null || true
    fi
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  fi
  rm -f -- "$candidate" "$temporary" "$response_file"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$route_state" = installed ]; then
  candidate="$(mktemp "${caddyfile}.l7-ready.XXXXXX")"
  temporary="$(mktemp "${caddyfile}.l7-ready.live.XXXXXX")"
  awk -v site="$site_line" -v marker="$route_marker" '
    $0 == site {
      print
      print "  " marker
      print "  @lemtel_load_balancer_ready path /lemtel-lb-ready"
      print "  handle @lemtel_load_balancer_ready {"
      print "    root * /etc/caddy"
      print "    rewrite * /lemtel-lb-ready"
      print "    header Content-Type application/json"
      print "    file_server"
      print "  }"
      next
    }
    { print }
  ' "$caddyfile" > "$candidate"
  docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null || fail caddy_candidate_invalid
  cp --preserve=mode,ownership,timestamps -- "$candidate" "$temporary"
  chmod --reference="$caddyfile" "$temporary"
  mv -f -- "$temporary" "$caddyfile"
  replaced=true
fi

docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_live_invalid
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_reload_failed
LEMTEL_HA_EXECUTE=enable_digitalocean_writer_l7_ready_timer \
  LEMTEL_HA_ROLE=digitalocean_promoted_writer \
  LEMTEL_L7_READY_SOURCE="$refresh_source" \
  bash "$timer_source"
attest_l7_response || fail l7_http_attestation_failed

success=true
printf 'do_writer_l7_route_deploy_format=lemtel_do_writer_l7_route_v1\n'
printf 'writer=digitalocean_promoted_writer\n'
printf 'route_state=%s\n' "$route_state"
printf 'route_deployed=true\n'
printf 'marker_timer_enabled=true\n'
printf 'l7_http_attested=true\n'
printf 'dns_change_executed=false\n'
printf 'cloudflare_routing_changed=false\n'
printf 'hostinger_runtime_started=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_l7_route_deploy_status=complete\n'
