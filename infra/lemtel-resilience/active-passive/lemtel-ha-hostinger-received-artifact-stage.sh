#!/usr/bin/env bash
# Root-only, fail-closed staging of the verified received runtime envelope on Hostinger.
# It never starts a runtime, publishes ports, promotes PostgreSQL, changes routing, or touches telephony.
set -euo pipefail
fail() { printf 'hostinger_received_artifact_stage_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'stage_hostinger_received_runtime_envelope' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

artifact_dir='/var/lib/lemtel-ha/artifacts/hostinger-received'
current_digest_file="$artifact_dir/current.sha256"
age_identity='/etc/lemtel-ha/age/identity.txt'
base_dir='/opt/lemtel-ha'
runtime_stage="$base_dir/runtime-stage"
resolve_standby_postgres() {
  local -a candidates=()
  mapfile -t candidates < <(docker ps -a --format '{{.Names}}|{{.Image}}' | awk -F'|' '$2 ~ /(^|\/)postgres(:|$)|supabase\/postgres(:|$)/ { print $1 }')
  [ "${#candidates[@]}" -eq 1 ] && printf '%s' "${candidates[0]}"
}
postgres_container="$(resolve_standby_postgres || true)"
[ -n "$postgres_container" ] || fail standby_postgres_unresolved

command -v age >/dev/null 2>&1 || fail age_missing
command -v tar >/dev/null 2>&1 || fail tar_missing
command -v sha256sum >/dev/null 2>&1 || fail sha256sum_missing
command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl is-active --quiet docker || fail docker_inactive
systemctl is-active --quiet wg-quick@lemtel-ha0 || fail wireguard_inactive
direct_envelope="${LEMTEL_HA_RUNTIME_ENVELOPE:-}"
artifact_receipt='existing_verified_artifact'
if [ -n "$direct_envelope" ]; then
  [ "$direct_envelope" = '/tmp/lemtel-hostinger-runtime.age' ] || fail unexpected_direct_envelope_path
  expected_direct_sha="${LEMTEL_HA_RUNTIME_ENVELOPE_SHA256:-}"
  [[ "$expected_direct_sha" =~ ^[a-f0-9]{64}$ ]] || fail direct_envelope_sha256_invalid
  [ -f "$direct_envelope" ] || fail direct_envelope_missing
  [ "$(sha256sum "$direct_envelope" | awk '{print $1}')" = "$expected_direct_sha" ] || fail direct_envelope_sha256_mismatch
  input_envelope="$direct_envelope"
  envelope_source='direct_verified_transfer'
  artifact_receipt='pending_direct_receipt'
else
  [ -s "$current_digest_file" ] || fail artifact_digest_missing
  artifact_digest="$(tr -d '[:space:]' < "$current_digest_file")"
  [[ "$artifact_digest" =~ ^[a-f0-9]{64}$ ]] || fail artifact_digest_invalid
  artifact_file="$artifact_dir/$artifact_digest.tgz"
  [ -f "$artifact_file" ] || fail artifact_archive_missing
  [ "$(sha256sum "$artifact_file" | awk '{print $1}')" = "$artifact_digest" ] || fail artifact_digest_mismatch
  input_envelope="$artifact_file"
  envelope_source='immutable_source_artifact'
fi
[ -r "$age_identity" ] || fail age_identity_missing
[ ! -e "$runtime_stage" ] || fail runtime_stage_already_exists

docker inspect "$postgres_container" >/dev/null 2>&1 || fail standby_postgres_missing
[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true ] || fail standby_postgres_not_running
[ -z "$(docker port "$postgres_container" 2>/dev/null || true)" ] || fail standby_postgres_port_published

install -d -o root -g root -m 0700 "$base_dir"
work_dir="$(mktemp -d "$base_dir/.runtime-stage.XXXXXX")"
work_tar="$(mktemp "$base_dir/.runtime-stage.tar.XXXXXX")"
cleanup() { rm -rf -- "$work_dir"; rm -f -- "$work_tar"; }
trap cleanup EXIT
age -d -i "$age_identity" -o "$work_tar" "$input_envelope" || fail runtime_envelope_decryption_failed

while IFS= read -r entry; do
  case "$entry" in
    .env|docker-compose.yml|docker-compose.caddy.yml|docker-compose.lemtel-private.yml|docker-compose.lemtel-db-init.yml|volumes/|volumes/functions/|volumes/functions/*|volumes/proxy/|volumes/proxy/caddy/|volumes/proxy/caddy/*|volumes/api/|volumes/api/envoy/|volumes/api/envoy/envoy.yaml|volumes/api/envoy/cds.yaml|volumes/api/envoy/lds.template.yaml|volumes/api/envoy/docker-entrypoint.sh)
      ;;
    *) fail envelope_content_unapproved ;;
  esac
done < <(tar -tf "$work_tar")
if tar -tvf "$work_tar" | grep -q '^l'; then fail envelope_contains_symlink; fi

tar --extract --file "$work_tar" --directory "$work_dir" --no-same-owner --no-same-permissions
for envoy_file in volumes/api/envoy/envoy.yaml volumes/api/envoy/cds.yaml volumes/api/envoy/lds.template.yaml volumes/api/envoy/docker-entrypoint.sh; do
  [ -f "$work_dir/$envoy_file" ] || fail runtime_envoy_file_missing
done
find "$work_dir" -type d -exec chmod 0700 {} +
find "$work_dir" -type f -exec chmod 0600 {} +
(
  cd "$work_dir"
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml config >/dev/null
) || fail runtime_compose_invalid
while IFS= read -r runtime_container; do
  [ -z "$runtime_container" ] && continue
  [ "$runtime_container" = "$postgres_container" ] || fail standby_runtime_running
done < <(docker ps --filter label=com.docker.compose.project=lemtel-ha-standby --format '{{.Names}}')
if [ "$envelope_source" = direct_verified_transfer ]; then
  install -d -o root -g root -m 0700 "$artifact_dir"
  artifact_receipt="$artifact_dir/$expected_direct_sha.tgz"
  artifact_receipt_tmp="$(mktemp "$artifact_dir/.runtime-envelope.XXXXXX")"
  current_digest_tmp="$(mktemp "$artifact_dir/.current.XXXXXX")"
  cp -- "$direct_envelope" "$artifact_receipt_tmp"
  chmod 0600 "$artifact_receipt_tmp"
  [ "$(sha256sum "$artifact_receipt_tmp" | awk '{print $1}')" = "$expected_direct_sha" ] || fail artifact_receipt_digest_mismatch
  mv -- "$artifact_receipt_tmp" "$artifact_receipt"
  printf '%s\n' "$expected_direct_sha" > "$current_digest_tmp"
  chmod 0600 "$current_digest_tmp"
  mv -- "$current_digest_tmp" "$current_digest_file"
  artifact_receipt='registered_direct_verified_transfer'
fi
mv -- "$work_dir" "$runtime_stage"
trap - EXIT
printf 'hostinger_received_artifact_stage_format=lemtel_hostinger_received_artifact_stage_v1\n'
printf 'standby=hostinger_private_standby\n'
printf 'runtime_envelope_source=%s\n' "$envelope_source"
printf 'runtime_envelope_digest_verified=true\n'
printf 'runtime_envelope_receipt=%s\n' "$artifact_receipt"
printf 'runtime_envelope_decrypted_root_only=true\n'
printf 'runtime_stage_compose_verified=true\n'
printf 'runtime_stage_prepared=true\n'
printf 'runtime_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_received_artifact_stage_status=complete\n'
