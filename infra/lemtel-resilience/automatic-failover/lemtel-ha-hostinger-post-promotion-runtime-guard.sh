#!/usr/bin/env bash
# Root-only local readiness guard after a separately authorized Hostinger promotion.
# It reads an already-recorded local promotion state and signed single-writer
# evidence. It never starts a runtime, changes traffic, or contacts a provider.
set -euo pipefail

fail() {
  printf 'hostinger_post_promotion_runtime_guard_status=%s\n' "$1" >&2
  exit 1
}

secure_root_file() {
  [ -f "$1" ] && [ -O "$1" ] && [ "$(stat -c '%a' "$1")" = '600' ]
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_GUARD_MODE:-}" = 'verify_hostinger_post_promotion_runtime_readiness_only' ] || fail readiness_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_promoted_writer' ] || fail invalid_role

incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
case "$incident_id" in
  ''|*[!a-z0-9-]*) fail invalid_incident_id ;;
esac
[ "${#incident_id}" -ge 8 ] || fail invalid_incident_id

state_dir='/var/lib/lemtel-ha/current-topology-evidence'
promotion_state="$state_dir/hostinger-promotion.state"
single_writer_evidence="$state_dir/single-writer.evidence"
single_writer_signature="$state_dir/single-writer.evidence.asc"
single_writer_keyring="$state_dir/single-writer-evidence.gpg"
runtime_stage_state="$state_dir/hostinger-runtime-stage.state"

command -v gpgv >/dev/null 2>&1 || fail gpgv_missing
command -v grep >/dev/null 2>&1 || fail grep_missing
command -v stat >/dev/null 2>&1 || fail stat_missing
secure_root_file "$promotion_state" || fail hostinger_promotion_state_missing_or_insecure
secure_root_file "$single_writer_evidence" || fail single_writer_evidence_missing_or_insecure
secure_root_file "$single_writer_signature" || fail single_writer_signature_missing_or_insecure
secure_root_file "$single_writer_keyring" || fail single_writer_keyring_missing_or_insecure
secure_root_file "$runtime_stage_state" || fail hostinger_runtime_stage_missing_or_insecure

grep -Fxq 'format=lemtel_hostinger_promotion_state_v1' "$promotion_state" || fail promotion_state_format_invalid
grep -Fxq "incident_id=$incident_id" "$promotion_state" || fail promotion_state_incident_mismatch
grep -Fxq 'writer_role=hostinger_promoted_writer' "$promotion_state" || fail promotion_state_role_invalid
grep -Fxq 'promotion_executed=true' "$promotion_state" || fail promotion_state_not_promoted
grep -Fxq 'automatic_promotion_enabled=false' "$promotion_state" || fail promotion_state_automatic_flag_invalid

gpgv --keyring "$single_writer_keyring" "$single_writer_signature" "$single_writer_evidence" >/dev/null 2>&1 || fail single_writer_evidence_signature_invalid
grep -Fxq 'format=lemtel_single_writer_evidence_v1' "$single_writer_evidence" || fail single_writer_evidence_format_invalid
grep -Fxq "incident_id=$incident_id" "$single_writer_evidence" || fail single_writer_evidence_incident_mismatch
grep -Fxq 'writer_role=hostinger_promoted_writer' "$single_writer_evidence" || fail single_writer_evidence_role_invalid
grep -Fxq 'do_writer_fenced=true' "$single_writer_evidence" || fail do_writer_not_fenced
grep -Fxq 'single_writer_confirmed=true' "$single_writer_evidence" || fail single_writer_not_confirmed
grep -Fxq 'public_database_listener_enabled=false' "$single_writer_evidence" || fail public_database_listener_detected

grep -Fxq 'format=lemtel_hostinger_runtime_stage_v1' "$runtime_stage_state" || fail runtime_stage_format_invalid
grep -Fxq "incident_id=$incident_id" "$runtime_stage_state" || fail runtime_stage_incident_mismatch
grep -Fxq 'runtime_staged=true' "$runtime_stage_state" || fail runtime_not_staged
grep -Fxq 'runtime_running=false' "$runtime_stage_state" || fail runtime_already_running
grep -Fxq 'encrypted_runtime_stage=true' "$runtime_stage_state" || fail runtime_stage_not_encrypted

printf 'post_promotion_runtime_guard_format=lemtel_hostinger_post_promotion_runtime_guard_v1\n'
printf 'declared_role=hostinger_promoted_writer\n'
printf 'incident_id_matched=true\n'
printf 'existing_promotion_state_verified=true\n'
printf 'single_writer_evidence_signature_verified=true\n'
printf 'do_writer_fenced=true\n'
printf 'single_writer_confirmed=true\n'
printf 'runtime_staged=true\n'
printf 'runtime_running=false\n'
printf 'runtime_start_executed=false\n'
printf 'automatic_runtime_start_enabled=false\n'
printf 'automatic_traffic_routing_enabled=false\n'
printf 'automatic_failback_enabled=false\n'
printf 'hostinger_post_promotion_runtime_guard_status=readiness_only\n'
