#!/usr/bin/env bash
# Root-only staging of the encrypted Supabase/Edge runtime envelope on the DO standby.
# This validates configuration only; it never starts a public runtime, database, Storage, or telephony service.
set -euo pipefail

fail() {
  printf 'standby_runtime_stage_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'stage_private_standby_runtime_envelope' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_standby' ] || fail invalid_role

base_dir='/opt/lemtel-ha'
stage_dir="$base_dir/runtime-stage"
input_envelope="${LEMTEL_HA_RUNTIME_ENVELOPE:-/home/lemtelops/lemtel-standby-runtime.age}"
age_identity='/etc/lemtel-ha/age/identity.txt'
work_dir="$base_dir/artifacts"
work_tar="$work_dir/.runtime-stage.tar"

case "$input_envelope" in /home/lemtelops/lemtel-standby-runtime.age) ;; *) fail unexpected_envelope_path ;; esac
command -v age >/dev/null 2>&1 || fail age_missing
command -v tar >/dev/null 2>&1 || fail tar_missing
command -v docker >/dev/null 2>&1 || fail docker_missing
[ -s "$input_envelope" ] || fail envelope_missing
[ -r "$age_identity" ] || fail age_identity_missing
[ ! -e "$stage_dir" ] || fail stage_directory_already_exists
systemctl is-active --quiet docker || fail docker_inactive
docker inspect lemtel-postgres-standby >/dev/null 2>&1 || fail standby_database_missing
[ "$(docker inspect --format '{{.State.Running}}' lemtel-postgres-standby)" = true ] || fail standby_database_not_running
[ -z "$(docker port lemtel-postgres-standby 2>/dev/null || true)" ] || fail standby_database_port_published

install -d -o root -g root -m 0700 "$work_dir"
age -d -i "$age_identity" -o "$work_tar" "$input_envelope" || fail envelope_decryption_failed
trap 'rm -f "$work_tar"' EXIT

# Only files required for a dormant runtime configuration are allowed.
while IFS= read -r entry; do
  case "$entry" in
    .env|docker-compose.yml|docker-compose.caddy.yml|docker-compose.lemtel-private.yml|docker-compose.lemtel-db-init.yml|volumes/|volumes/functions/|volumes/functions/*|volumes/proxy/|volumes/proxy/caddy/|volumes/proxy/caddy/*)
      ;;
    *) fail envelope_content_unapproved ;;
  esac
done < <(tar -tf "$work_tar")
if tar -tvf "$work_tar" | grep -q '^l'; then
  fail envelope_contains_symlink
fi

install -d -o root -g root -m 0700 "$stage_dir"
tar --extract --file "$work_tar" --directory "$stage_dir" --no-same-owner --no-same-permissions
find "$stage_dir" -type d -exec chmod 0700 {} +
find "$stage_dir" -type f -exec chmod 0600 {} +

cd "$stage_dir"
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.caddy.yml \
  -f docker-compose.lemtel-private.yml \
  -f docker-compose.lemtel-db-init.yml \
  config >/dev/null || fail compose_validation_failed

# The staging operation must not launch or recreate any container.
[ "$(docker ps --format '{{.Names}}' | sort | paste -sd, -)" = 'lemtel-postgres-standby' ] || fail unexpected_runtime_container

printf 'standby_runtime_stage_format=lemtel_standby_runtime_stage_v1\n'
printf 'declared_role=digitalocean_standby\n'
printf 'runtime_envelope_decrypted_root_only=true\n'
printf 'runtime_compose_validation=true\n'
printf 'runtime_stage_prepared=true\n'
printf 'containers_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'storage_runtime_started=false\n'
printf 'postgres_listener_5432_started=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'fusionpbx_or_sip_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'standby_runtime_stage_status=complete\n'
