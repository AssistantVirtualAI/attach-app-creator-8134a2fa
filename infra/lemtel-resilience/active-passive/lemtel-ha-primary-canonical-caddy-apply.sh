#!/usr/bin/env bash
# Root-only, transactional application of the previously validated canonical Caddy candidate.
# DNS creation, client cutover, failover, Storage, PostgreSQL, and telephony are out of scope.
set -euo pipefail

fail() {
  printf 'primary_canonical_caddy_apply_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'apply_private_primary_canonical_caddy_route' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_primary' ] || fail invalid_role

compose_dir='/opt/lemtel-staging-bootstrap/lemtel-supabase'
caddyfile="$compose_dir/volumes/proxy/caddy/Caddyfile"
stage_dir='/var/lib/lemtel-ha/canonical-route'
candidate="$stage_dir/Caddyfile.lemtel-canonical"
manifest="$stage_dir/Caddyfile.lemtel-canonical.manifest"
backup_dir="$stage_dir/backups"
caddy_container='supabase-caddy'
canonical_host='lemtel.assistantvirtualai.com'
lock_file='/var/lock/lemtel-ha-canonical-caddy.lock'

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v awk >/dev/null 2>&1 || fail awk_missing
command -v cmp >/dev/null 2>&1 || fail cmp_missing
command -v flock >/dev/null 2>&1 || fail flock_missing
[ -f "$caddyfile" ] || fail caddyfile_missing
[ -s "$candidate" ] || fail candidate_missing
[ -s "$manifest" ] || fail manifest_missing

docker inspect "$caddy_container" >/dev/null 2>&1 || fail caddy_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_container_not_running
mounts="$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$caddy_container")"
printf '%s\n' "$mounts" | grep -Fxq '/etc/caddy' || fail caddy_config_mount_missing

grep -Fxq 'format=lemtel_primary_canonical_caddy_route_v1' "$manifest" || fail candidate_manifest_invalid
grep -Fxq "canonical_host=$canonical_host" "$manifest" || fail candidate_hostname_invalid
grep -Fxq 'candidate_validated=true' "$manifest" || fail candidate_not_validated
grep -Fxq 'live_caddyfile_replaced=false' "$manifest" || fail candidate_manifest_not_dormant

exec 9>"$lock_file"
flock -n 9 || fail concurrent_canonical_caddy_apply

expected="$(mktemp "${caddyfile}.lemtel-expected.XXXXXX")"
temporary="$(mktemp "${caddyfile}.lemtel-new.XXXXXX")"
backup=''
replaced=false

rollback() {
  if [ "$replaced" = true ] && [ -n "$backup" ] && [ -f "$backup" ]; then
    cp -- "$backup" "$caddyfile"
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  fi
  rm -f "$expected" "$temporary"
}
trap rollback ERR INT TERM

site_directive_count="$(grep -Fxc '{$PROXY_DOMAIN} {' "$caddyfile" || true)"
[ "$site_directive_count" = 1 ] || fail unexpected_proxy_domain_site_directive
! grep -Fq "$canonical_host" "$caddyfile" || fail canonical_hostname_already_live

awk -v canonical_host="$canonical_host" '
  $0 == "{$PROXY_DOMAIN} {" {
    print "{$PROXY_DOMAIN}, " canonical_host " {"
    next
  }
  { print }
' "$caddyfile" > "$expected"
cmp -s "$expected" "$candidate" || fail candidate_no_longer_matches_live_caddyfile

# Re-parse the exact staged candidate before the mounted Caddyfile is swapped.
docker exec -i "$caddy_container" caddy adapt --config /dev/stdin --adapter caddyfile < "$candidate" >/dev/null || fail staged_caddyfile_invalid

install -d -o root -g root -m 0700 "$backup_dir"
backup="$backup_dir/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ)"
cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
cp -- "$candidate" "$temporary"
chmod --reference="$caddyfile" "$temporary"
mv -f -- "$temporary" "$caddyfile"
replaced=true

docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail live_caddyfile_invalid
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail caddy_reload_failed

replaced=false
trap - ERR INT TERM
rm -f "$expected"

printf 'primary_canonical_caddy_apply_format=lemtel_primary_canonical_caddy_apply_v1\n'
printf 'declared_role=hostinger_primary\n'
printf 'existing_proxy_domain_preserved=true\n'
printf 'caddy_candidate_revalidated=true\n'
printf 'live_caddyfile_replaced=true\n'
printf 'caddy_reloaded=true\n'
printf 'rollback_available=true\n'
printf 'dns_change_executed=false\n'
printf 'client_cutover_executed=false\n'
printf 'runtime_restarted=false\n'
printf 'storage_runtime_started=false\n'
printf 'postgres_listener_5432_started=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'primary_canonical_caddy_apply_status=complete\n'
