#!/usr/bin/env bash
# Root-only registration of an already staged, encrypted Hostinger runtime envelope.
# It never decrypts content, starts a runtime, publishes a port, promotes PostgreSQL or changes routing.
set -euo pipefail
fail() { printf 'hostinger_direct_envelope_receipt_status=failed\nreason=%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'record_hostinger_direct_runtime_envelope_receipt' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || fail invalid_role

direct_envelope="${LEMTEL_HA_RUNTIME_ENVELOPE:-}"
[ "$direct_envelope" = '/tmp/lemtel-hostinger-runtime.age' ] || fail unexpected_direct_envelope_path
expected_direct_sha="${LEMTEL_HA_RUNTIME_ENVELOPE_SHA256:-}"
[[ "$expected_direct_sha" =~ ^[a-f0-9]{64}$ ]] || fail direct_envelope_sha256_invalid
[ -f "$direct_envelope" ] || fail direct_envelope_missing
[ "$(sha256sum "$direct_envelope" | awk '{print $1}')" = "$expected_direct_sha" ] || fail direct_envelope_sha256_mismatch

command -v docker >/dev/null 2>&1 || fail docker_missing
systemctl is-active --quiet docker || fail docker_inactive
runtime_stage='/opt/lemtel-ha/runtime-stage'
for required in .env docker-compose.yml docker-compose.caddy.yml docker-compose.lemtel-private.yml docker-compose.lemtel-db-init.yml; do
  [ -f "$runtime_stage/$required" ] || fail runtime_stage_missing
done
[ -d "$runtime_stage/volumes/functions" ] || fail runtime_functions_missing
[ -d "$runtime_stage/volumes/proxy/caddy" ] || fail runtime_caddy_missing
(
  cd "$runtime_stage"
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.lemtel-private.yml -f docker-compose.lemtel-db-init.yml config >/dev/null
) || fail runtime_compose_invalid

artifact_dir='/var/lib/lemtel-ha/artifacts/hostinger-received'
receipt="$artifact_dir/$expected_direct_sha.tgz"
current_digest_file="$artifact_dir/current.sha256"
install -d -o root -g root -m 0700 "$artifact_dir"
if [ -e "$receipt" ]; then
  [ -f "$receipt" ] || fail artifact_receipt_type_invalid
  [ "$(sha256sum "$receipt" | awk '{print $1}')" = "$expected_direct_sha" ] || fail artifact_receipt_digest_mismatch
  receipt_state='already_registered'
else
  receipt_tmp="$(mktemp "$artifact_dir/.runtime-envelope.XXXXXX")"
  cleanup() { rm -f -- "$receipt_tmp"; }
  trap cleanup EXIT
  cp -- "$direct_envelope" "$receipt_tmp"
  chmod 0600 "$receipt_tmp"
  [ "$(sha256sum "$receipt_tmp" | awk '{print $1}')" = "$expected_direct_sha" ] || fail artifact_receipt_digest_mismatch
  mv -- "$receipt_tmp" "$receipt"
  trap - EXIT
  receipt_state='registered'
fi
previous_receipt='none'
if [ -e "$current_digest_file" ]; then
  [ -f "$current_digest_file" ] || fail current_receipt_type_invalid
  current_digest="$(tr -d '[:space:]' < "$current_digest_file")"
  [[ "$current_digest" =~ ^[a-f0-9]{64}$ ]] || fail current_receipt_digest_invalid
  if [ "$current_digest" != "$expected_direct_sha" ]; then
    current_artifact="$artifact_dir/$current_digest.tgz"
    [ -f "$current_artifact" ] || fail current_artifact_missing
    [ "$(sha256sum "$current_artifact" | awk '{print $1}')" = "$current_digest" ] || fail current_artifact_digest_mismatch
    history_dir="$artifact_dir/history"
    install -d -o root -g root -m 0700 "$history_dir"
    previous_tmp="$(mktemp "$history_dir/.previous.XXXXXX")"
    printf '%s\n' "$current_digest" > "$previous_tmp"
    chmod 0600 "$previous_tmp"
    mv -- "$previous_tmp" "$history_dir/$(date -u +%Y%m%dT%H%M%SZ)-current.sha256"
    previous_receipt='preserved'
  fi
fi
current_digest_tmp="$(mktemp "$artifact_dir/.current.XXXXXX")"
printf '%s\n' "$expected_direct_sha" > "$current_digest_tmp"
chmod 0600 "$current_digest_tmp"
mv -- "$current_digest_tmp" "$current_digest_file"
printf 'hostinger_direct_envelope_receipt_format=lemtel_hostinger_direct_envelope_receipt_v1\n'
printf 'standby=hostinger_private_standby\n'
printf 'runtime_stage_existing_verified=true\n'
printf 'artifact_receipt=%s\n' "$receipt_state"
printf 'previous_artifact_receipt=%s\n' "$previous_receipt"
printf 'artifact_digest_verified=true\n'
printf 'runtime_started=false\n'
printf 'public_listener_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_failover_enabled=false\n'
printf 'fencing_executed=false\n'
printf 'telephony_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'hostinger_direct_envelope_receipt_status=complete\n'
