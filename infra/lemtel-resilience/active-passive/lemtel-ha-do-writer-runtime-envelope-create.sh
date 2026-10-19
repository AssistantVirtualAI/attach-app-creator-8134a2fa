#!/usr/bin/env bash
# Root-only creation of a Hostinger-encrypted dormant runtime envelope from the DO writer.
# PostgreSQL and Storage data are deliberately excluded and no runtime is started or reconfigured.
set -euo pipefail
fail() { printf 'do_writer_runtime_envelope_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'create_hostinger_runtime_envelope' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail invalid_role

runtime_paths=(
  .env
  docker-compose.yml
  docker-compose.caddy.yml
  docker-compose.lemtel-private.yml
  docker-compose.lemtel-db-init.yml
  volumes/functions
  volumes/proxy/caddy
  volumes/api/envoy/envoy.yaml
  volumes/api/envoy/cds.yaml
  volumes/api/envoy/lds.template.yaml
  volumes/api/envoy/docker-entrypoint.sh
  volumes/pooler/pooler.exs
)
valid_compose_dir() {
  local candidate="$1" path
  [ -n "$candidate" ] && [ -d "$candidate" ] || return 1
  for path in "${runtime_paths[@]}"; do [ -e "$candidate/$path" ] || return 1; done
}
resolve_active_compose_dir() {
  local -a candidates=() valid=()
  local candidate
  mapfile -t candidates < <(docker ps --format '{{.Label "com.docker.compose.project.working_dir"}}' | awk 'NF { print }' | sort -u)
  for candidate in "${candidates[@]}"; do
    valid_compose_dir "$candidate" && valid+=("$candidate")
  done
  [ "${#valid[@]}" -eq 1 ] && printf '%s' "${valid[0]}"
}
requested_compose_dir="${LEMTEL_HA_RUNTIME_SOURCE_DIR:-}"
if [ -n "$requested_compose_dir" ]; then
  case "$requested_compose_dir" in /*) ;; *) fail invalid_runtime_source_directory ;; esac
  valid_compose_dir "$requested_compose_dir" || fail invalid_runtime_source_directory
  compose_dir="$requested_compose_dir"
else
  compose_dir="$(resolve_active_compose_dir || true)"
  [ -n "$compose_dir" ] || fail compose_directory_unresolved
fi
stage_dir='/var/lib/lemtel-ha/runtime-envelope'
envelope_file="$stage_dir/hostinger-runtime.age"
manifest_file="$stage_dir/hostinger-runtime.manifest"
age_recipient="${LEMTEL_HA_HOSTINGER_AGE_RECIPIENT:-}"
case "$age_recipient" in age1[0-9a-z]*) ;; *) fail invalid_hostinger_age_recipient ;; esac
command -v docker >/dev/null 2>&1 || fail docker_missing
command -v age >/dev/null 2>&1 || fail age_missing
command -v tar >/dev/null 2>&1 || fail tar_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
printf '' | age -r "$age_recipient" -o /dev/null || fail invalid_hostinger_age_recipient

cd "$compose_dir"
for path in "${runtime_paths[@]}"; do
  [ -e "$path" ] || fail "runtime_path_missing_$(basename "$path")"
  [ ! -L "$path" ] || fail "runtime_path_symlink_$(basename "$path")"
  if find "$path" -type l -print -quit | grep -q .; then fail "runtime_tree_symlink_$(basename "$path")"; fi
done
install -d -o root -g root -m 0700 "$stage_dir"
tar_file="$(mktemp "$stage_dir/.runtime.XXXXXX.tar")"
envelope_tmp="$(mktemp "$stage_dir/.hostinger-runtime.XXXXXX.age")"
manifest_tmp="$(mktemp "$stage_dir/.hostinger-runtime.XXXXXX.manifest")"
cleanup() { rm -f -- "$tar_file" "$envelope_tmp" "$manifest_tmp"; }
trap cleanup EXIT
tar --create --file "$tar_file" --numeric-owner --format=posix "${runtime_paths[@]}"
if tar -tf "$tar_file" | grep -Eq '(^/|(^|/)\.\.(/|$)|^volumes/(db|storage)(/|$))'; then fail envelope_content_unsafe; fi
if tar -tvf "$tar_file" | grep -q '^l'; then fail envelope_contains_symlink; fi
age -r "$age_recipient" -o "$envelope_tmp" "$tar_file"
chmod 0600 "$envelope_tmp"
envelope_sha256="$(sha256sum "$envelope_tmp" | awk '{print $1}')"
{
  printf 'format=lemtel_hostinger_runtime_envelope_v1\n'
  printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'encrypted_envelope_sha256=%s\n' "$envelope_sha256"
  printf 'database_data_included=false\n'
  printf 'storage_data_included=false\n'
  printf 'plaintext_values_emitted=false\n'
} > "$manifest_tmp"
chmod 0600 "$manifest_tmp"
mv -f -- "$envelope_tmp" "$envelope_file"
mv -f -- "$manifest_tmp" "$manifest_file"
printf 'do_writer_runtime_envelope_format=lemtel_do_writer_runtime_envelope_v1\n'
printf 'writer=digitalocean_writer\n'
printf 'runtime_envelope_created=true\n'
printf 'runtime_envelope_encrypted=true\n'
printf 'database_data_included=false\n'
printf 'storage_data_included=false\n'
printf 'runtime_started=false\n'
printf 'dns_change_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'do_writer_runtime_envelope_status=complete\n'
