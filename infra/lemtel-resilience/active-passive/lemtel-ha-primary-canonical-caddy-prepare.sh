#!/usr/bin/env bash
# Root-only preparation of a dormant Caddy route for the approved Lemtel hostname.
# It never replaces the live Caddyfile, reloads Caddy, or changes DNS.
set -euo pipefail

fail() {
  printf 'primary_canonical_caddy_prepare_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'prepare_private_primary_canonical_caddy_route' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

compose_dir='/opt/lemtel-staging-bootstrap/lemtel-supabase'
caddyfile="$compose_dir/volumes/proxy/caddy/Caddyfile"
stage_dir='/var/lib/lemtel-ha/canonical-route'
candidate="$stage_dir/Caddyfile.lemtel-canonical"
manifest="$stage_dir/Caddyfile.lemtel-canonical.manifest"
canonical_host='lemtel.assistantvirtualai.com'
caddy_container='supabase-caddy'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v awk >/dev/null 2>&1 || fail awk_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
[ -d "$compose_dir" ] || fail compose_directory_missing
[ -f "$caddyfile" ] || fail caddyfile_missing
[ ! -e "$candidate" ] || fail candidate_already_exists
[ ! -e "$manifest" ] || fail manifest_already_exists

docker inspect "$caddy_container" >/dev/null 2>&1 || fail caddy_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_container_not_running
mounts="$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$caddy_container")"
printf '%s\n' "$mounts" | grep -Fxq '/etc/caddy' || fail caddy_config_mount_missing

site_directive_count="$(grep -Fxc '{$PROXY_DOMAIN} {' "$caddyfile" || true)"
[ "$site_directive_count" = 1 ] || fail unexpected_proxy_domain_site_directive
! grep -Fq "$canonical_host" "$caddyfile" || fail canonical_hostname_already_present

install -d -o root -g root -m 0700 "$stage_dir"
awk -v canonical_host="$canonical_host" '
  $0 == "{$PROXY_DOMAIN} {" {
    print "{$PROXY_DOMAIN}, " canonical_host " {"
    next
  }
  { print }
' "$caddyfile" > "$candidate"
chmod 0600 "$candidate"

# Parse the staged Caddyfile inside the current image without replacing its mounted live file.
docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null || fail staged_caddyfile_invalid

candidate_sha256="$(sha256sum "$candidate" | awk '{print $1}')"
{
  printf 'format=lemtel_primary_canonical_caddy_route_v1\n'
  printf 'canonical_host=%s\n' "$canonical_host"
  printf 'candidate_sha256=%s\n' "$candidate_sha256"
  printf 'existing_proxy_domain_preserved=true\n'
  printf 'candidate_validated=true\n'
  printf 'live_caddyfile_replaced=false\n'
  printf 'caddy_reloaded=false\n'
  printf 'dns_change_executed=false\n'
  printf 'credential_values_emitted=false\n'
} > "$manifest"
chmod 0600 "$manifest"

printf 'primary_canonical_caddy_prepare_format=lemtel_primary_canonical_caddy_route_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'canonical_route_candidate_created=true\n'
printf 'existing_proxy_domain_preserved=true\n'
printf 'candidate_validated=true\n'
printf 'live_caddyfile_replaced=false\n'
printf 'caddy_reloaded=false\n'
printf 'dns_change_executed=false\n'
printf 'runtime_restarted=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_canonical_caddy_prepare_status=complete\n'
