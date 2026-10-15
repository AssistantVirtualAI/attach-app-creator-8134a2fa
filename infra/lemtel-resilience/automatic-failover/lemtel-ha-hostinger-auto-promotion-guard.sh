#!/usr/bin/env bash
# Root-only local readiness guard for the current Lemtel hostinger_private_hot_standby.
# This guard verifies local evidence only. It does not promote PostgreSQL, start a
# runtime, publish a database, change traffic, or contact a provider.
set -euo pipefail

fail() {
  printf 'hostinger_auto_promotion_guard_status=%s\n' "$1" >&2
  exit 1
}

secure_root_file() {
  [ -f "$1" ] && [ -O "$1" ] && [ "$(stat -c '%a' "$1")" = '600' ]
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_GUARD_MODE:-}" = 'verify_hostinger_promotion_readiness_only' ] || fail readiness_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_private_hot_standby' ] || fail invalid_role

incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
case "$incident_id" in
  ''|*[!a-z0-9-]*) fail invalid_incident_id ;;
esac
[ "${#incident_id}" -ge 8 ] || fail invalid_incident_id

db_container="${LEMTEL_HA_LOCAL_POSTGRES_CONTAINER:-}"
case "$db_container" in
  ''|*[!a-zA-Z0-9_.-]*) fail local_postgres_container_required ;;
esac

state_dir='/var/lib/lemtel-ha/current-topology-evidence'
fence_attestation="$state_dir/do-writer-provider-fence.attestation"
fence_signature="$state_dir/do-writer-provider-fence.attestation.asc"
fence_keyring="$state_dir/provider-fence-attestation.gpg"
runtime_stage_state="$state_dir/hostinger-runtime-stage.state"

command -v docker >/dev/null 2>&1 || fail docker_missing
command -v gpgv >/dev/null 2>&1 || fail gpgv_missing
command -v grep >/dev/null 2>&1 || fail grep_missing
command -v ss >/dev/null 2>&1 || fail ss_missing
command -v stat >/dev/null 2>&1 || fail stat_missing
secure_root_file "$fence_attestation" || fail do_writer_fence_attestation_missing_or_insecure
secure_root_file "$fence_signature" || fail do_writer_fence_signature_missing_or_insecure
secure_root_file "$fence_keyring" || fail provider_fence_keyring_missing_or_insecure
secure_root_file "$runtime_stage_state" || fail hostinger_runtime_stage_missing_or_insecure

gpgv --keyring "$fence_keyring" "$fence_signature" "$fence_attestation" >/dev/null 2>&1 || fail do_writer_fence_attestation_signature_invalid
grep -Fxq 'format=lemtel_do_writer_provider_fence_attestation_v1' "$fence_attestation" || fail do_writer_fence_attestation_format_invalid
grep -Fxq "incident_id=$incident_id" "$fence_attestation" || fail do_writer_fence_attestation_incident_mismatch
grep -Fxq 'writer_role=do_writer' "$fence_attestation" || fail do_writer_fence_attestation_role_invalid
grep -Fxq 'writer_fenced=true' "$fence_attestation" || fail do_writer_fence_not_verified

grep -Fxq 'format=lemtel_hostinger_runtime_stage_v1' "$runtime_stage_state" || fail runtime_stage_format_invalid
grep -Fxq "incident_id=$incident_id" "$runtime_stage_state" || fail runtime_stage_incident_mismatch
grep -Fxq 'runtime_staged=true' "$runtime_stage_state" || fail runtime_not_staged
grep -Fxq 'runtime_running=false' "$runtime_stage_state" || fail runtime_not_stopped
grep -Fxq 'encrypted_runtime_stage=true' "$runtime_stage_state" || fail runtime_stage_not_encrypted
grep -Fxq 'public_database_listener_enabled=false' "$runtime_stage_state" || fail runtime_stage_public_database_listener_detected

docker inspect "$db_container" >/dev/null 2>&1 || fail local_postgres_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" = true ] || fail local_postgres_container_not_running
if docker port "$db_container" | grep -q .; then fail database_published_port_detected; fi
if ss -H -ltn 'sport = :5432' | grep -q .; then fail host_postgres_listener_detected; fi

recovery="$(docker exec -u postgres "$db_container" psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')"
[ "$recovery" = t ] || fail standby_not_in_recovery
receiver="$(docker exec -u postgres "$db_container" psql -X -At -d postgres -c 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')"
[ "$receiver" = streaming ] || fail standby_not_streaming

printf 'promotion_guard_format=lemtel_hostinger_auto_promotion_guard_v1\n'
printf 'declared_role=hostinger_private_hot_standby\n'
printf 'incident_id_matched=true\n'
printf 'do_writer_fence_attestation_signature_verified=true\n'
printf 'standby_in_recovery=true\n'
printf 'standby_wal_receiver_streaming=true\n'
printf 'runtime_staged=true\n'
printf 'runtime_running=false\n'
printf 'public_database_listener_enabled=false\n'
printf 'promotion_executed=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_runtime_start_enabled=false\n'
printf 'automatic_traffic_routing_enabled=false\n'
printf 'hostinger_auto_promotion_guard_status=readiness_only\n'
