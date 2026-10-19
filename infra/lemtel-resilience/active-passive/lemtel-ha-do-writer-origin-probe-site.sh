#!/usr/bin/env bash
# Installs (or checks) the DigitalOcean-only origin probe site for the failover arbiter:
#   https://lemtel-do-l7.assistantvirtualai.com/lemtel-lb-ready
# The hostname is a proxied Cloudflare record that points at the DigitalOcean writer ONLY (it is not behind
# the Load Balancer). While the public host may be steered to Hostinger by the Load Balancer, this probe always
# reaches DigitalOcean, so Cloudflare answers 521/522 quickly and unambiguously when the writer is down.
# It serves exactly the same marker file as the public route (404 when the writer is not healthy) and 404 for
# every other path. TLS is Caddy's internal issuer (Cloudflare SSL mode "full").
# No DNS, routing, provider, promotion, fencing, database or telephony action is performed.
#   usage: lemtel-ha-do-writer-origin-probe-site.sh install|status   (root)
set -euo pipefail

fail() { printf 'do_origin_probe_site_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"
case "$mode" in install|status) ;; *) fail usage_install_or_status ;; esac
T="${LEMTEL_OPS_TEST_ROOT:-}"   # test hook only (fixtures and fake tools on PATH)
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required

probe_host='lemtel-do-l7.assistantvirtualai.com'
begin='# LEMTEL_DO_ORIGIN_PROBE_V1'
end='# LEMTEL_DO_ORIGIN_PROBE_V1_END'
public_marker='# LEMTEL_LOAD_BALANCER_READY_V1'
caddy_container='supabase-caddy'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v curl >/dev/null 2>&1 || fail curl_missing
command -v python3 >/dev/null 2>&1 || fail python3_missing
docker inspect "$caddy_container" >/dev/null 2>&1 || fail caddy_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_not_running
caddy_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy_container")"
[ -n "$caddy_mount" ] || fail caddy_mount_missing
caddyfile="$caddy_mount/Caddyfile"
[ -f "$caddyfile" ] && [ ! -L "$caddyfile" ] || fail caddyfile_missing
# The probe only re-exposes the writer marker: the public route (and its marker timer) must already exist.
[ "$(grep -Fc "$public_marker" "$caddyfile" || true)" = 1 ] || fail public_l7_route_missing

local_probe() {
  # Through the local Caddy, exactly as Cloudflare reaches it (SNI and Host = the probe hostname).
  curl --silent --insecure --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 10 \
    --proto '=https' --max-redirs 0 --resolve "${probe_host}:443:127.0.0.1" "https://${probe_host}$1" || printf '000'
}

desired_block() {
  cat <<EOF
$begin
${probe_host} {
  tls internal
  @lemtel_do_origin_ready path /lemtel-lb-ready
  handle @lemtel_do_origin_ready {
    root * /etc/caddy
    rewrite * /lemtel-lb-ready.json
    file_server
  }
  handle {
    respond 404
  }
}
$end
EOF
}

# Prints: absent | current | drifted. Exits non-zero on an ambiguous Caddyfile.
block_state() {
  python3 -I - "$caddyfile" "$begin" "$end" "$1" <<'PY'
import sys
path, begin, end, desired = sys.argv[1:5]
lines = open(path, encoding='utf-8').read().split('\n')
starts = [i for i, line in enumerate(lines) if line == begin]
ends = [i for i, line in enumerate(lines) if line == end]
if not starts and not ends:
    print('absent'); sys.exit(0)
if len(starts) != 1 or len(ends) != 1 or ends[0] < starts[0]:
    sys.exit(1)
print('current' if '\n'.join(lines[starts[0]:ends[0] + 1]) == desired else 'drifted')
PY
}

desired="$(desired_block)"
state="$(block_state "$desired")" || fail probe_block_ambiguous

if [ "$mode" = status ]; then
  printf 'do_origin_probe_site_format=lemtel_do_origin_probe_site_v1\n'
  printf 'probe_host=%s\nprobe_block=%s\n' "$probe_host" "$state"
  printf 'probe_marker_http=%s\nprobe_other_path_http=%s\n' "$(local_probe /lemtel-lb-ready)" "$(local_probe /)"
  printf 'do_origin_probe_site_status=complete\n'
  exit 0
fi

install -d -m 0755 "$T/var/lock"
exec 9>"$T/var/lock/lemtel-ha-do-origin-probe-site.lock"
flock -n 9 || fail concurrent_install

backup_root="$T/var/lib/lemtel-ha/l7-ready/backups"
install -d -m 0700 "$backup_root"
backup_dir="$(mktemp -d "$backup_root/origin-probe.XXXXXX")"
backup="$backup_dir/Caddyfile"
cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
candidate=''; replaced=false; success=false
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$success" != true ] && [ "$replaced" = true ]; then
    restore="$(mktemp "${caddyfile}.origin-probe.rollback.XXXXXX")" || restore=''
    if [ -n "$restore" ]; then
      cp --preserve=mode,ownership,timestamps -- "$backup" "$restore" 2>/dev/null || true
      mv -f -- "$restore" "$caddyfile" 2>/dev/null || true
    fi
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  fi
  rm -f -- "$candidate"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$state" != current ]; then
  candidate="$(mktemp "${caddyfile}.origin-probe.XXXXXX")"
  python3 -I - "$caddyfile" "$begin" "$end" "$desired" "$candidate" <<'PY' || fail candidate_build_failed
import sys
path, begin, end, desired, out = sys.argv[1:6]
lines = open(path, encoding='utf-8').read().split('\n')
if begin in lines:
    start, stop = lines.index(begin), lines.index(end)
    lines = lines[:start] + lines[stop + 1:]
while lines and lines[-1] == '':
    lines.pop()
open(out, 'w', encoding='utf-8').write('\n'.join(lines + ['', desired, '']))
PY
  docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null 2>&1 \
    || fail caddy_candidate_invalid
  chmod --reference="$caddyfile" "$candidate"
  chown --reference="$caddyfile" "$candidate"
  # Same inode semantics as the public route deploy: replace the file inside the bind-mounted directory.
  mv -f -- "$candidate" "$caddyfile"
  candidate=''
  replaced=true
  docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail caddy_live_invalid
  docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail caddy_reload_failed
fi

marker_code=''
for _ in 1 2 3 4 5 6; do
  marker_code="$(local_probe /lemtel-lb-ready)"
  [ "$marker_code" = 200 ] && break
  sleep 5
done
[ "$marker_code" = 200 ] || fail probe_marker_not_served
[ "$(local_probe /)" = 404 ] || fail probe_other_path_not_404

success=true
printf 'do_origin_probe_site_format=lemtel_do_origin_probe_site_v1\n'
printf 'probe_host=%s\n' "$probe_host"
printf 'probe_block_before=%s\n' "$state"
printf 'probe_marker_http=200\nprobe_other_path_http=404\n'
printf 'dns_change_executed=false\ncloudflare_routing_changed=false\nfencing_executed=false\n'
printf 'do_origin_probe_site_status=complete\n'
