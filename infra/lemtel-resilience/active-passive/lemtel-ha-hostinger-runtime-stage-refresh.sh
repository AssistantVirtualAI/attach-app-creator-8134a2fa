#!/usr/bin/env bash
# Root-only refresh of the dormant Hostinger runtime stage from a DO runtime envelope (age-encrypted to the
# Hostinger identity). Keeps the staged runtime identical to the live DO runtime (compose, .env, Edge
# functions, Caddy, Envoy, pooler) with three Hostinger-specific rules:
#   - no readiness marker is ever staged: a promoted Hostinger publishes its own, only while healthy;
#   - Caddy serves lemtel.assistantvirtualai.com with `tls internal` (Cloudflare SSL "full" accepts it), so a
#     promotion never waits on an ACME certificate in the middle of an outage;
#   - the previous stage is kept as a backup and restored if anything fails.
# It never starts a runtime, publishes ports, promotes PostgreSQL, changes routing or touches telephony.
set -euo pipefail
umask 077
fail() { printf 'hostinger_runtime_stage_refresh_status=failed\nreason=%s\n' "$1"; exit 1; }
[ "${LEMTEL_HA_EXECUTE:-}" = 'refresh_hostinger_runtime_stage' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role
root="${LEMTEL_HSR_TEST_ROOT:-}"   # test hook only: offline fixtures under a temporary root
own=(-o root -g root)
if [ -n "$root" ]; then own=(); else [ "$(id -u)" -eq 0 ] || fail root_required; fi
stage="$root/opt/lemtel-ha/runtime-stage"
base="$root/opt/lemtel-ha"
backups="$root/var/lib/lemtel-ha/runtime-stage-backups"
artifact_dir="$root/var/lib/lemtel-ha/artifacts/hostinger-received"
identity="${LEMTEL_HSR_AGE_IDENTITY:-/etc/lemtel-ha/age/identity.txt}"
envelope="${LEMTEL_HA_RUNTIME_ENVELOPE:-}"
expected="${LEMTEL_HA_RUNTIME_ENVELOPE_SHA256:-}"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail envelope_sha256_invalid
[ -f "$envelope" ] && [ ! -L "$envelope" ] || fail envelope_missing
[ "$(sha256sum "$envelope" | awk '{print $1}')" = "$expected" ] || fail envelope_sha256_mismatch
[ -r "$identity" ] || fail age_identity_missing
[ -d "$stage" ] || fail current_stage_missing
standby="$(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /supabase\/postgres(:|$)/ {print $1}')"
[ "$(printf '%s\n' "$standby" | grep -c .)" = 1 ] || fail standby_postgres_unresolved
[ "$(docker exec -u postgres "$standby" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')" = t ] || fail standby_not_in_recovery
[ -z "$(docker ps -q --filter label=com.docker.compose.project=lemtel-ha-hostinger-promoted)" ] || fail promoted_runtime_running
exec 9>"$root/run/lemtel-hostinger-runtime-stage-refresh.lock"; flock -n 9 || fail concurrent_refresh
work="$(mktemp -d "$base/.runtime-refresh.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
age -d -i "$identity" -o "$work/runtime.tar" "$envelope" 2>/dev/null || fail envelope_decrypt_failed
listing="$(tar -tvf "$work/runtime.tar")" || fail envelope_not_a_tar
if printf '%s\n' "$listing" | grep -Eq '^[lhcbp]'; then fail envelope_contains_links_or_devices; fi
while IFS= read -r entry; do
  case "$entry" in
    /*|*..*) fail envelope_path_unsafe ;;
    .env|docker-compose.yml|docker-compose.caddy.yml|docker-compose.lemtel-private.yml|docker-compose.lemtel-db-init.yml) ;;
    volumes/functions|volumes/functions/*|volumes/proxy/caddy|volumes/proxy/caddy/*|volumes/pooler/pooler.exs) ;;
    volumes/api/envoy/envoy.yaml|volumes/api/envoy/cds.yaml|volumes/api/envoy/lds.template.yaml|volumes/api/envoy/docker-entrypoint.sh) ;;
    *) fail "envelope_unexpected_path" ;;
  esac
done < <(tar -tf "$work/runtime.tar" | sed 's#/$##')
new="$work/runtime-stage"; mkdir -m 0700 "$new"
tar -xf "$work/runtime.tar" -C "$new" --no-same-owner
for path in .env docker-compose.yml docker-compose.caddy.yml docker-compose.lemtel-private.yml docker-compose.lemtel-db-init.yml volumes/functions volumes/proxy/caddy/Caddyfile volumes/api/envoy/envoy.yaml; do
  [ -e "$new/$path" ] || fail "envelope_missing_$(basename "$path")"
done
# Pooler configuration: from the envelope, otherwise kept from the current stage.
if [ ! -f "$new/volumes/pooler/pooler.exs" ]; then
  [ -f "$stage/volumes/pooler/pooler.exs" ] || fail pooler_config_missing
  install -d -m 0755 "$new/volumes/pooler"; install -m 0644 "$stage/volumes/pooler/pooler.exs" "$new/volumes/pooler/pooler.exs"
fi
# Never stage a writer readiness marker (or leftover portal staging folders) from the DO runtime.
rm -f -- "$new/volumes/proxy/caddy/lemtel-lb-ready" "$new/volumes/proxy/caddy/lemtel-lb-ready.json"
find "$new/volumes/proxy/caddy" -maxdepth 1 -name '.lemtel-portal-governance-stage.*' -exec rm -rf -- {} +
/usr/bin/python3 -I - "$new/volumes/proxy/caddy/Caddyfile" <<'PY' || fail caddyfile_transform_failed
import sys
path = sys.argv[1]
lines = open(path, encoding='utf-8').read().split('\n')
# The DigitalOcean-only origin probe site must never be served by Hostinger.
begin, end = '# LEMTEL_DO_ORIGIN_PROBE_V1', '# LEMTEL_DO_ORIGIN_PROBE_V1_END'
if (begin in lines) != (end in lines) or lines.count(begin) > 1 or lines.count(end) > 1:
    sys.exit(1)
if begin in lines:
    start, stop = lines.index(begin), lines.index(end)
    if stop < start:
        sys.exit(1)
    lines = lines[:start] + lines[stop + 1:]
if any('lemtel-do-l7.' in line for line in lines):
    sys.exit(1)
out, patched = [], 0
for index, line in enumerate(lines):
    out.append(line)
    if not line.startswith((' ', '\t', '#')) and 'lemtel.assistantvirtualai.com' in line and line.rstrip().endswith('{'):
        following = lines[index + 1].strip() if index + 1 < len(lines) else ''
        if following != 'tls internal':
            out.append('  tls internal')
        patched += 1
if patched != 1:
    sys.exit(1)
open(path, 'w', encoding='utf-8').write('\n'.join(out))
PY
(
  cd "$new"
  services="$(docker compose --project-name lemtel-ha-hostinger-promoted --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml config --services | sort | paste -sd, -)"
  [ "$services" = 'api-gw,auth,caddy,db,functions,imgproxy,meta,realtime,rest,storage,studio,supavisor' ]
) || fail staged_compose_invalid
chmod 0700 "$new"
install -d "${own[@]}" -m 0700 "$backups" "$artifact_dir"
backup="$backups/runtime-stage.$(date -u +%Y%m%dT%H%M%SZ)"
mv -- "$stage" "$backup"
if ! mv -- "$new" "$stage"; then mv -- "$backup" "$stage"; fail stage_swap_failed_previous_restored; fi
install "${own[@]}" -m 0600 "$envelope" "$artifact_dir/$expected.tgz"
printf '%s\n' "$expected" > "$artifact_dir/.current.sha256.tmp"; chmod 0600 "$artifact_dir/.current.sha256.tmp"
mv -f -- "$artifact_dir/.current.sha256.tmp" "$artifact_dir/current.sha256"
printf 'hostinger_runtime_stage_refresh_format=lemtel_hostinger_runtime_stage_refresh_v1\n'
printf 'runtime_envelope_sha256=%s\nstaged_readiness_marker=false\ncaddy_tls=internal_for_lemtel_host\ndo_origin_probe_site_staged=false\npooler_config_present=true\n' "${expected:0:12}"
printf 'previous_stage_backup=kept\nruntime_started=false\nstandby_postgres_touched=false\nhostinger_runtime_stage_refresh_status=complete\n'
