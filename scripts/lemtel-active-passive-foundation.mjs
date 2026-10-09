// Validates the approved Lemtel active-passive rollout foundation.
// It deliberately has no network, secret, process, DNS, Docker, or deployment capability.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CONTRACT_PATH = 'infra/lemtel-resilience/active-passive/contract.json';

const CONTRACT_KEYS = ['contract_version', 'scope', 'source_branch', 'authorization', 'topology', 'required_evidence', 'safety_boundaries', 'implementation_state'];
const AUTHORIZATION_KEYS = ['active_passive_implementation_authorized', 'fusionpbx_or_sip_activation_authorized', 'planipret_data_in_scope', 'client_cutover_authorized'];
const TOPOLOGY_KEYS = ['primary', 'standby', 'writer_policy', 'database_replication', 'storage_replication', 'runtime_delivery', 'traffic_routing', 'commit_acknowledgement_policy'];
const EVIDENCE_KEYS = ['hostinger_admin_ssh_verified', 'digitalocean_admin_ssh_verified', 'matching_postgres_major_version_verified', 'storage_layout_inventory_verified', 'standby_basebackup_verified', 'replication_lag_monitoring_verified', 'storage_integrity_monitoring_verified', 'external_health_routing_verified', 'fencing_verified', 'failover_drill_verified', 'failback_drill_verified'];
const SAFETY_KEYS = ['standby_database_publicly_exposed', 'plaintext_secret_replication', 'raw_postgres_volume_copy', 'automatic_promotion_without_fencing', 'fusionpbx_or_sip_change'];
const STATE_KEYS = ['remote_runtime_enabled', 'dns_failover_enabled', 'automatic_failover_enabled'];

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const everyFalse = (value) => Object.values(value).every((entry) => entry === false);

export function validateActivePassiveFoundation(contract) {
  return exactKeys(contract, CONTRACT_KEYS) &&
    contract.contract_version === 'lemtel_active_passive_foundation_v1' &&
    contract.scope === 'verified_active_passive_rollout_without_telephony' &&
    contract.source_branch === 'lemtel/integration' &&
    exactKeys(contract.authorization, AUTHORIZATION_KEYS) &&
    contract.authorization.active_passive_implementation_authorized === true &&
    contract.authorization.fusionpbx_or_sip_activation_authorized === false &&
    contract.authorization.planipret_data_in_scope === false &&
    contract.authorization.client_cutover_authorized === false &&
    exactKeys(contract.topology, TOPOLOGY_KEYS) &&
    contract.topology.primary === 'hostinger_primary' &&
    contract.topology.standby === 'digitalocean_warm_standby' &&
    contract.topology.writer_policy === 'single_writer_hostinger' &&
    contract.topology.database_replication === 'postgres_physical_streaming_with_replication_slot' &&
    contract.topology.storage_replication === 'inventory_required_before_backend_specific_replication' &&
    contract.topology.runtime_delivery === 'immutable_artifact_same_digest_on_both_hosts' &&
    contract.topology.traffic_routing === 'external_health_checked_active_passive' &&
    contract.topology.commit_acknowledgement_policy === 'pending_owner_rpo_availability_choice' &&
    exactKeys(contract.required_evidence, EVIDENCE_KEYS) && everyFalse(contract.required_evidence) &&
    exactKeys(contract.safety_boundaries, SAFETY_KEYS) && everyFalse(contract.safety_boundaries) &&
    exactKeys(contract.implementation_state, STATE_KEYS) && everyFalse(contract.implementation_state);
}

export function reviewActivePassiveFoundation(contract) {
  if (!validateActivePassiveFoundation(contract)) {
    return { status: 'active_passive_foundation_invalid', implementation_authorized: false, reasons: ['ACTIVE_PASSIVE_FOUNDATION_INVALID'] };
  }

  return {
    status: 'active_passive_foundation_authorized_pending_evidence',
    implementation_authorized: true,
    hostinger_primary: 'authorized_pending_admin_inventory',
    digitalocean_standby: 'authorized_pending_admin_inventory',
    fusionpbx_or_sip_change_authorized: false,
    client_cutover_authorized: false,
    automatic_failover_enabled: false,
    reasons: [
      'ADMIN_SSH_AND_RUNTIME_INVENTORY_REQUIRED',
      'POSTGRES_VERSION_AND_STORAGE_BACKEND_REQUIRED',
      'OWNER_RPO_AVAILABILITY_POLICY_REQUIRED',
      'FENCING_EXTERNAL_HEALTH_ROUTING_AND_DRILL_REQUIRED'
    ]
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const contract = JSON.parse(reader(join(root, CONTRACT_PATH), 'utf8'));
    const review = reviewActivePassiveFoundation(contract);
    return { code: review.status === 'active_passive_foundation_authorized_pending_evidence' ? 0 : 1, stdout: `${JSON.stringify(review)}\n` };
  } catch {
    return { code: 1, stdout: '{"status":"active_passive_foundation_invalid","implementation_authorized":false,"reasons":["ACTIVE_PASSIVE_FOUNDATION_UNREADABLE"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
