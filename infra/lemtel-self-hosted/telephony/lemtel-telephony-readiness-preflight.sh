#!/usr/bin/env bash
# Root-only, read-only readiness check. It never connects to a provider or prints credentials.
set -euo pipefail

fail() {
  printf 'telephony_readiness_status=failed\n' >&2
  printf 'reason=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ] || fail writer_role_required
command -v docker >/dev/null 2>&1 || fail docker_missing

docker ps >/dev/null 2>&1 || fail docker_unavailable
edge_container='supabase-edge-functions'
auth_container='supabase-auth'
for container in "$edge_container" "$auth_container"; do
  docker inspect "$container" >/dev/null 2>&1 || fail container_missing
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || fail container_not_running
done

has_env() {
  local name="$1"
  docker exec "$edge_container" sh -eu -c "test -n \"\${$name:-}\"" >/dev/null 2>&1
}

signup_disabled="$(docker exec "$auth_container" sh -eu -c 'test "${GOTRUE_DISABLE_SIGNUP:-false}" = true' >/dev/null 2>&1 && printf true || printf false)"

printf 'telephony_readiness_format=lemtel_telephony_readiness_v1\n'
printf 'writer_verified=true\n'
printf 'public_signup_disabled=%s\n' "$signup_disabled"
printf 'account_authority_endpoint_present=%s\n' "$(has_env SUPABASE_URL && printf true || printf false)"
printf 'provider_profile_present=%s\n' "$(has_env LEMTEL_TELEPHONY_PROVIDER_PROFILE && printf true || printf false)"
printf 'transport_profile_present=%s\n' "$(has_env LEMTEL_TELEPHONY_TRANSPORT_PROFILE && printf true || printf false)"
printf 'extension_mapping_contract_present=%s\n' "$(has_env LEMTEL_TELEPHONY_EXTENSION_MAPPING_CONTRACT && printf true || printf false)"
printf 'server_credential_broker_present=%s\n' "$(has_env LEMTEL_TELEPHONY_CREDENTIAL_BROKER && printf true || printf false)"
printf 'push_ios_evidence_present=%s\n' "$(has_env LEMTEL_TELEPHONY_IOS_PUSH_EVIDENCE && printf true || printf false)"
printf 'push_android_evidence_present=%s\n' "$(has_env LEMTEL_TELEPHONY_ANDROID_PUSH_EVIDENCE && printf true || printf false)"
printf 'provider_contacted=false\n'
printf 'provider_write_executed=false\n'
printf 'sip_registration_attempted=false\n'
printf 'dns_change_executed=false\n'
printf 'hostinger_contacted=false\n'
printf 'credential_values_emitted=false\n'
printf 'telephony_readiness_status=complete\n'
