#!/usr/bin/env bash
# Root-only, local evidence contract for the current Lemtel do_writer topology.
# It accepts only an explicit acknowledgement that an authorized operator received
# a provider fence attestation out of band. It never contacts a provider, stores
# attestation material, or fences a writer.
set -euo pipefail

fail() {
  printf 'do_writer_provider_fence_evidence_status=%s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_HA_EVIDENCE_MODE:-}" = 'record_out_of_band_do_writer_fence_attestation' ] || fail evidence_mode_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'do_writer' ] || fail invalid_role
[ "${LEMTEL_HA_PROVIDER_FENCE_RECEIPT_ACK:-}" = 'authorized_operator_received_out_of_band_attestation' ] || fail attestation_receipt_token_required

incident_id="${LEMTEL_HA_INCIDENT_ID:-}"
case "$incident_id" in
  ''|*[!a-z0-9-]*) fail invalid_incident_id ;;
esac
[ "${#incident_id}" -ge 8 ] || fail invalid_incident_id

printf 'evidence_contract_format=lemtel_do_writer_provider_fence_evidence_v1\n'
printf 'declared_role=do_writer\n'
printf 'incident_id_recorded=true\n'
printf 'secure_receipt_channel=authorized_out_of_band_attestation_repository\n'
printf 'provider_attestation_receipt_acknowledged=true\n'
printf 'provider_attestation_material_persisted=false\n'
printf 'provider_api_contacted=false\n'
printf 'provider_fencing_executed=false\n'
printf 'automatic_provider_fencing_enabled=false\n'
printf 'automatic_promotion_enabled=false\n'
printf 'automatic_traffic_routing_enabled=false\n'
printf 'automatic_failback_enabled=false\n'
printf 'do_writer_provider_fence_evidence_status=contract_only\n'
