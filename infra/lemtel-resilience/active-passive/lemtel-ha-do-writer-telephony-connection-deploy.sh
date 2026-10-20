#!/usr/bin/env bash
# Root-only deployment of the Lemtel "Connexion FusionPBX" + failover-status release on the DO WRITER.
#   check  : read-only preflight (layout, writer authority, bundle digests). Changes nothing.
#   deploy : migration 0024 (idempotent) -> functions env (.env + docker-compose.lemtel-private.yml, both carried to
#            Hostinger by the encrypted runtime envelope) -> Edge sources -> functions container recreated -> portal.
#            Every replaced file is backed up first and restored automatically on any failure.
# The PBX encryption key is generated ON THE SERVER once (openssl), never printed, never overwritten.
# Credential delivery to the apps stays DISABLED. Never touches DNS, routing, Hostinger, FusionPBX or telephony.
set -euo pipefail
umask 077
T="${LEMTEL_TC_TEST_ROOT:-}"   # test hook only (fake docker/openssl on PATH, files under a temporary root)
fail() { printf 'telephony_connection_deploy_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
mode="${1:-}"
case "$mode" in check|deploy) ;; *) fail usage_check_or_deploy ;; esac
[ -n "$T" ] || [ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
bundle="${LEMTEL_TC_BUNDLE:-}"
[ -n "$bundle" ] && [ -d "$bundle" ] || fail bundle_missing
manifest="$bundle/manifest.sha256"
FILES=(0024_lemtel_pbx_connection.sql lemtelPbxConnection.ts lemtel-pbx-connection-admin.index.ts lemtel-softphone-provisioning.index.ts lemtel-failover-status.index.ts portal.tar)
[ -s "$manifest" ] || fail manifest_missing
for f in "${FILES[@]}"; do
  tok="$(printf '%s' "${f%%.*}" | tr -c 'a-z0-9' '_')"
  [ -s "$bundle/$f" ] && [ ! -L "$bundle/$f" ] || fail "bundle_file_missing_$tok"
  expected="$(awk -v n="$f" '$2 == n {print $1}' "$manifest")"
  [ -n "$expected" ] && [ "$(sha256sum "$bundle/$f" | awk '{print $1}')" = "$expected" ] || fail "bundle_digest_mismatch_$tok"
done

command -v docker >/dev/null 2>&1 || fail docker_missing
fence_status="$( [ -n "$T" ] && cat "$T/fence-status" 2>/dev/null || /usr/local/sbin/lemtel-ha-do-writer-boot-fence status 2>/dev/null || true)"
case "$fence_status" in *boot_fence=fenced*) fail do_is_fenced_not_the_writer ;; esac
db="$(docker ps --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /supabase\/postgres(:|$)/ {print $1}')"
[ "$(printf '%s\n' "$db" | grep -c .)" = 1 ] || fail database_container_unresolved
# Superuser session proven like the failback tooling: supabase_admin on the container loopback (the DO container was
# re-created by the failback and may not carry POSTGRES_USER), else the container's own POSTGRES_USER.
su_mode=''
if [ "$(docker exec -u postgres -e PGCONNECT_TIMEOUT=5 "$db" psql -X -At -d postgres -h 127.0.0.1 -U supabase_admin -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)" = t ]; then
  su_mode=loopback
elif [ "$(docker exec "$db" sh -c 'export PSQLRC=/dev/null; psql -X -At -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"' 2>/dev/null)" = t ]; then
  su_mode=env
else
  fail superuser_session_unavailable
fi
psql_su() {
  if [ "$su_mode" = loopback ]; then docker exec -i -u postgres "$db" psql -X -At -v ON_ERROR_STOP=1 -d postgres -h 127.0.0.1 -U supabase_admin
  else docker exec -i "$db" sh -eu -c 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"'; fi
}
[ "$(printf 'SELECT pg_is_in_recovery()::text;\n' | psql_su 2>/dev/null)" = false ] || fail writer_not_verified
edge='supabase-edge-functions'; caddy='supabase-caddy'
for c in "$edge" "$caddy"; do [ "$(docker inspect --format '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || fail "container_not_running_$(printf %s "$c" | tr -c "a-z0-9" _)"; done
dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$edge")"
project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$edge")"
service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$edge")"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [[ "$service" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail compose_labels_invalid
dir="$T$dir"
COMPOSE_FILES=(docker-compose.yml docker-compose.caddy.yml docker-compose.lemtel-private.yml docker-compose.lemtel-db-init.yml)
# Optional transactional email wiring (kept when present in the working directory).
OPTIONAL_COMPOSE_FILES=(docker-compose.lemtel-onboarding.yml)
for f in .env "${COMPOSE_FILES[@]}"; do [ -f "$dir/$f" ] && [ ! -L "$dir/$f" ] || fail "runtime_file_missing_$f"; done
functions_dir="$T$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$edge")"
caddy_dir="$T$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$caddy")"
[ -d "$functions_dir" ] && [ -d "$functions_dir/_shared" ] || fail functions_mount_missing
[ -d "$caddy_dir/lemtel-portal" ] && [ -f "$caddy_dir/Caddyfile" ] || fail portal_directory_missing
command -v python3 >/dev/null 2>&1 || fail python3_missing
# Same route validator as the production static refresh: the ownership comment may repeat; the functional handler
# '@lemtel_operations_portal' must be unique and serve /etc/caddy/lemtel-portal.
python3 - "$caddy_dir/Caddyfile" '# LEMTEL_OPERATIONS_PORTAL_V1' <<'PY' || fail portal_route_missing_or_ambiguous
import re,sys
text=open(sys.argv[1],encoding='utf-8').read(); marker=re.escape(sys.argv[2])
try:
  if len(re.findall(r'(?m)^\s*'+marker+r'\s*$',text))<1: raise ValueError
  blocks=re.findall(r'(?ms)^\s*handle\s+@lemtel_operations_portal\s*\{\s*(.*?)^\s*\}',text)
  if len(blocks)!=1: raise ValueError
  block=blocks[0]
  for line in (r'^\s*uri\s+strip_prefix\s+/lemtel-portal\s*$',r'^\s*root\s+\*\s+/etc/caddy/lemtel-portal\s*$',r'^\s*try_files\s+\{path\}\s+/lemtel-portal\.html\s*$',r'^\s*file_server\s*$'):
    if len(re.findall(line,block,re.M))!=1: raise ValueError
except Exception: raise SystemExit(1)
PY
# Recreate with the functions container's OWN Compose chain (config files + env files recorded in its labels): earlier
# Lemtel activations appended overrides/secrets there, and a fixed file list would silently drop them.
mapfile -t chain_files < <(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$edge" | tr ',' '\n' | sed '/^$/d')
mapfile -t chain_env < <(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.environment_file"}}' "$edge" | tr ',' '\n' | sed '/^$/d')
[ "${#chain_files[@]}" -gt 0 ] || fail edge_compose_chain_unresolved
[ "${#chain_env[@]}" -gt 0 ] || chain_env=("${dir#$T}/.env")
printf '%s\n' "${chain_files[@]}" | grep -qx "${dir#$T}/docker-compose.lemtel-private.yml" || chain_files+=("${dir#$T}/docker-compose.lemtel-private.yml")
for f in "${OPTIONAL_COMPOSE_FILES[@]}"; do
  [ -f "$dir/$f" ] && ! printf '%s\n' "${chain_files[@]}" | grep -qx "${dir#$T}/$f" && chain_files+=("${dir#$T}/$f")
done
compose_args=()
for e in "${chain_env[@]}"; do [ -f "$T$e" ] || fail edge_compose_env_file_missing; compose_args+=(--env-file "$T$e"); done
for f in "${chain_files[@]}"; do [ -f "$T$f" ] || fail edge_compose_file_missing; compose_args+=(-f "$T$f"); done
names_before="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge" | cut -d= -f1 | sort -u)"
compose() { docker compose --project-name "$project" --project-directory "$dir" "${compose_args[@]}" "$@"; }
compose config --services >/dev/null 2>&1 || fail compose_config_invalid_before_change
# Read the whole list first: with pipefail, "| grep -q" stops reading at the first match and Compose (one write per
# service) then dies on SIGPIPE, which made this check fail whenever "functions" was not the last service listed.
services_before="$(compose config --services 2>/dev/null)" || fail compose_config_invalid_before_change
grep -qx "$service" <<<"$services_before" || { printf 'compose_services=%s\n' "$(printf '%s\n' "$services_before" | paste -sd, -)" >&2; fail functions_service_not_in_compose; }
pbx_tables="$(printf "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'lemtel_pbx_%%';\n" | psql_su 2>/dev/null || echo unknown)"
key_present="$(grep -c '^LEMTEL_PBX_SECRET_ENCRYPTION_KEY=' "$dir/.env" || true)"
existing_admin="$( [ -f "$functions_dir/lemtel-pbx-connection-admin/index.ts" ] && echo present || echo absent)"

if [ "$mode" = check ]; then
  printf 'telephony_connection_deploy_format=lemtel_telephony_connection_deploy_v1\n'
  printf 'writer=digitalocean_writer\ncompose_project=%s\nfunctions_service=%s\n' "$project" "$service"
  printf 'pbx_tables_present=%s\nencryption_key_in_env=%s\npbx_admin_function=%s\n' "$pbx_tables" "$key_present" "$existing_admin"
  printf 'bundle_digests=verified\nchanges_made=false\ntelephony_connection_deploy_status=check_passed\n'
  exit 0
fi

[ "${LEMTEL_TC_EXECUTE:-}" = deploy_telephony_connection_and_portal ] || fail execution_token_required
command -v openssl >/dev/null 2>&1 || fail openssl_missing
exec 9>"$T/run/lemtel-telephony-connection-deploy.lock"; flock -n 9 || fail concurrent_deploy
backup="$T/var/lib/lemtel-ha/telephony-connection-deploy/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
cp -p "$dir/.env" "$backup/env"; cp -p "$dir/docker-compose.lemtel-private.yml" "$backup/docker-compose.lemtel-private.yml"
for d in _shared lemtel-pbx-connection-admin lemtel-softphone-provisioning lemtel-failover-status; do
  [ -d "$functions_dir/$d" ] && cp -a "$functions_dir/$d" "$backup/fn-$d" || true
done
env_changed=false; compose_changed=false; functions_changed=false; portal_swapped=false
finished=false
rollback() {
  local code=$?
  trap - EXIT INT TERM
  [ "$finished" = true ] && exit "$code"
  if [ "$env_changed" = true ] || [ "$compose_changed" = true ]; then
    cp -p "$backup/env" "$dir/.env"; cp -p "$backup/docker-compose.lemtel-private.yml" "$dir/docker-compose.lemtel-private.yml"
  fi
  if [ "$functions_changed" = true ]; then
    for d in lemtel-pbx-connection-admin lemtel-softphone-provisioning lemtel-failover-status; do
      rm -rf -- "${functions_dir:?}/$d"; [ -d "$backup/fn-$d" ] && cp -a "$backup/fn-$d" "$functions_dir/$d" || true
    done
    rm -f -- "$functions_dir/_shared/lemtelPbxConnection.ts"
    [ -f "$backup/fn-_shared/lemtelPbxConnection.ts" ] && cp -p "$backup/fn-_shared/lemtelPbxConnection.ts" "$functions_dir/_shared/" || true
  fi
  if [ "$env_changed" = true ] || [ "$compose_changed" = true ] || [ "$functions_changed" = true ]; then compose up -d --no-deps "$service" >/dev/null 2>&1 || true; fi
  if [ "$portal_swapped" = true ] && [ -d "$backup/lemtel-portal" ]; then rm -rf -- "${caddy_dir:?}/lemtel-portal"; mv "$backup/lemtel-portal" "$caddy_dir/lemtel-portal"; fi
  printf 'rolled_back=true\nbackup=%s\n' "$backup" >&2
  exit "$code"
}
trap rollback EXIT INT TERM

# 1. Schema (idempotent, Lemtel-only tables; no business data touched).
psql_su < "$bundle/0024_lemtel_pbx_connection.sql" >/dev/null
[ "$(printf "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('lemtel_pbx_connections','lemtel_pbx_connection_secrets','lemtel_pbx_extension_assignments','lemtel_pbx_connection_audit');\n" | psql_su)" = 4 ] || fail schema_not_applied

# 2. Function environment: values in .env (key generated here once), names wired in the Lemtel compose override.
add_env() { grep -q "^$1=" "$dir/.env" || { printf '%s=%s\n' "$1" "$2" >> "$dir/.env"; env_changed=true; }; }
if ! grep -q '^LEMTEL_PBX_SECRET_ENCRYPTION_KEY=' "$dir/.env"; then
  key="$(openssl rand -base64 32 | tr -d '\n')"
  [ "$(printf '%s' "$key" | base64 -d 2>/dev/null | wc -c)" = 32 ] || fail encryption_key_generation_failed
  printf 'LEMTEL_PBX_SECRET_ENCRYPTION_KEY=%s\n' "$key" >> "$dir/.env"; unset key; env_changed=true
fi
add_env LEMTEL_PBX_SECRET_KEY_VERSION 1
add_env LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY disabled
add_env LEMTEL_ARBITER_STATUS_URL https://lemtel-failover-arbiter.mhassoun.workers.dev
add_env LEMTEL_PUBLIC_SITE_URL https://lemtel.assistantvirtualai.com
# Names only (empty when unset): Lemtel-hosted TURN (D2) and call-notification keys (3.3) are filled in .env later
# by their own launchers; wiring the names here means adding a value never requires another compose edit.
VARS="LEMTEL_PBX_SECRET_ENCRYPTION_KEY LEMTEL_PBX_SECRET_KEY_VERSION LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY LEMTEL_ARBITER_STATUS_URL LEMTEL_PUBLIC_SITE_URL LEMTEL_CF_LB_READ_TOKEN LEMTEL_CF_ACCOUNT_ID LEMTEL_CF_DO_POOL_ID LEMTEL_CF_HOSTINGER_POOL_ID LEMTEL_STUN_URLS LEMTEL_TURN_URLS LEMTEL_TURN_SHARED_SECRET LEMTEL_PUSH_HOOK_SECRET LEMTEL_APNS_KEY_P8 LEMTEL_APNS_KEY_ID LEMTEL_APNS_TEAM_ID LEMTEL_APNS_BUNDLE_ID LEMTEL_FCM_SERVICE_ACCOUNT_JSON"
before="$(sha256sum "$dir/docker-compose.lemtel-private.yml")"
python3 - "$dir/docker-compose.lemtel-private.yml" "$service" $VARS <<'PY'
# Line-based, structure-preserving edit: under services.<service>.environment add "NAME: ${NAME:-}" for each missing
# name (map style) or "- NAME=${NAME:-}" (list style). Creates the service/environment block when absent.
import re, sys
path, service, names = sys.argv[1], sys.argv[2], sys.argv[3:]
lines = open(path).read().split("\n")
def indent(s): return len(s) - len(s.lstrip(" "))
def block_end(start, ind):
    i = start + 1
    while i < len(lines) and (lines[i].strip() == "" or lines[i].lstrip().startswith("#") or indent(lines[i]) > ind): i += 1
    while i - 1 > start and lines[i - 1].strip() == "": i -= 1
    return i
svc_root = next((i for i, l in enumerate(lines) if re.match(r"^services:\s*$", l)), None)
if svc_root is None:
    lines += ["services:"]; svc_root = len(lines) - 1
s_end = block_end(svc_root, 0)
svc = next((i for i in range(svc_root + 1, s_end) if re.match(r"^  %s:\s*$" % re.escape(service), lines[i])), None)
if svc is None:
    lines[s_end:s_end] = ["  %s:" % service, "    environment:"] + ["      %s: ${%s:-}" % (n, n) for n in names]
else:
    e_end = block_end(svc, 2)
    env = next((i for i in range(svc + 1, e_end) if re.match(r"^    environment:\s*$", lines[i])), None)
    if env is None:
        lines[svc + 1:svc + 1] = ["    environment:"] + ["      %s: ${%s:-}" % (n, n) for n in names]
    else:
        v_end = block_end(env, 4)
        body = [l for l in lines[env + 1:v_end] if l.strip() and not l.lstrip().startswith("#")]
        list_style = bool(body) and body[0].lstrip().startswith("- ")
        present = set()
        for l in body:
            m = re.match(r"^\s*-?\s*([A-Z0-9_]+)\s*[:=]", l)
            if m: present.add(m.group(1))
        add = [("      - %s=${%s:-}" if list_style else "      %s: ${%s:-}") % (n, n) for n in names if n not in present]
        lines[v_end:v_end] = add
open(path, "w").write("\n".join(lines))
PY
[ "$(sha256sum "$dir/docker-compose.lemtel-private.yml")" = "$before" ] || compose_changed=true
services_after="$(compose config --services 2>/dev/null)" || fail compose_config_invalid_after_change
grep -qx "$service" <<<"$services_after" || fail compose_config_invalid_after_change

# 3. Edge sources.
install -d -m 0755 "$functions_dir/lemtel-pbx-connection-admin" "$functions_dir/lemtel-softphone-provisioning" "$functions_dir/lemtel-failover-status"
functions_changed=true
install -m 0644 "$bundle/lemtelPbxConnection.ts" "$functions_dir/_shared/lemtelPbxConnection.ts"
install -m 0644 "$bundle/lemtel-pbx-connection-admin.index.ts" "$functions_dir/lemtel-pbx-connection-admin/index.ts"
install -m 0644 "$bundle/lemtel-softphone-provisioning.index.ts" "$functions_dir/lemtel-softphone-provisioning/index.ts"
install -m 0644 "$bundle/lemtel-failover-status.index.ts" "$functions_dir/lemtel-failover-status/index.ts"

# 4. Recreate only the functions container with the new environment, then prove the names (never the values).
compose up -d --no-deps "$service" >/dev/null
ok=false
for _ in $(seq 1 30); do [ "$(docker inspect --format '{{.State.Running}}' "$edge" 2>/dev/null)" = true ] && { ok=true; break; }; sleep 2; done
[ "$ok" = true ] || fail functions_not_running_after_recreate
names="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge" | cut -d= -f1)"
# Nothing the container had before may disappear (email, ingest secrets, ...).
while read -r n; do [ -z "$n" ] || printf '%s\n' "$names" | grep -qx "$n" || fail "function_env_lost_$n"; done <<< "$names_before"
for n in LEMTEL_PBX_SECRET_ENCRYPTION_KEY LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY LEMTEL_ARBITER_STATUS_URL; do
  printf '%s\n' "$names" | grep -qx "$n" || fail "function_env_missing_$n"
done

# 5. Portal: staged, checked, swapped; previous version kept in the backup.
stage="$(mktemp -d "$caddy_dir/.lemtel-portal-stage.XXXXXX")"
tar -xf "$bundle/portal.tar" -C "$stage" --no-same-owner
[ -s "$stage/lemtel-portal.html" ] && [ -d "$stage/assets" ] || { rm -rf -- "$stage"; fail portal_archive_invalid; }
if [ -n "$(find "$stage" \( -type l -o -name '*.map' -o -name '.env' \) -print -quit)" ]; then rm -rf -- "$stage"; fail portal_archive_unexpected_file; fi
chmod -R go+rX "$stage"
mv "$caddy_dir/lemtel-portal" "$backup/lemtel-portal"; portal_swapped=true
mv "$stage" "$caddy_dir/lemtel-portal"
[ -s "$caddy_dir/lemtel-portal/lemtel-portal.html" ] || fail portal_install_invalid
finished=true

printf 'telephony_connection_deploy_format=lemtel_telephony_connection_deploy_v1\n'
printf 'schema_0024=applied\nfunction_environment=%s\ncompose_override=%s\nedge_functions=deployed\nportal=deployed\n' \
  "$([ "$env_changed" = true ] && echo updated || echo unchanged)" "$([ "$compose_changed" = true ] && echo updated || echo unchanged)"
printf 'credential_delivery=disabled\nsecret_values_printed=false\nbackup=%s\ntelephony_connection_deploy_status=complete\n' "$backup"
