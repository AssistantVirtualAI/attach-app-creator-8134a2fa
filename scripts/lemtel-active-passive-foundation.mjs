// Validates the approved Lemtel active-passive rollout foundation.
// It deliberately has no network, secret, process, DNS, Docker, or deployment capability.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CONTRACT_PATH = 'infra/lemtel-resilience/active-passive/contract.json';

const CONTRACT_KEYS = ['contract_version', 'scope', 'source_branch', 'authorization', 'topology', 'required_evidence', 'safety_boundaries', 'implementation_state'];
const AUTHORIZATION_KEYS = ['active_passive_implementation_authorized', 'fusionpbx_or_sip_activation_authorized', 'planipret_data_in_scope', 'client_cutover_authorized'];
const TOPOLOGY_KEYS = ['primary', 'standby', 'writer_policy', 'database_replication', 'storage_replication', 'runtime_delivery', 'traffic_routing', 'canonical_public_hostname', 'routing_provider', 'routing_state', 'commit_acknowledgement_policy', 'recovery_point_policy'];
const EVIDENCE_KEYS = ['hostinger_admin_ssh_verified', 'digitalocean_admin_ssh_verified', 'matching_postgres_major_version_verified', 'storage_layout_inventory_verified', 'standby_basebackup_verified', 'replication_lag_monitoring_verified', 'storage_integrity_monitoring_verified', 'standby_runtime_config_staged', 'external_health_routing_verified', 'fencing_verified', 'failover_drill_verified', 'failback_drill_verified'];
const SAFETY_KEYS = ['standby_database_publicly_exposed', 'plaintext_secret_replication', 'raw_postgres_volume_copy', 'automatic_promotion_without_fencing', 'fusionpbx_or_sip_change'];
const STATE_KEYS = ['remote_runtime_enabled', 'dns_failover_enabled', 'automatic_failover_enabled'];
const VERIFIED_EVIDENCE = new Set(['hostinger_admin_ssh_verified', 'digitalocean_admin_ssh_verified', 'matching_postgres_major_version_verified', 'storage_layout_inventory_verified', 'standby_basebackup_verified', 'replication_lag_monitoring_verified', 'storage_integrity_monitoring_verified']);

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const everyFalse = (value) => Object.values(value).every((entry) => entry === false);

export function validateActivePassiveFoundation(contract) {
  const evidence = contract?.required_evidence;
  return exactKeys(contract, CONTRACT_KEYS) &&
    contract.contract_version === 'lemtel_active_passive_foundation_v5' &&
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
    contract.topology.canonical_public_hostname === 'lemtel.assistantvirtualai.com' &&
    contract.topology.routing_provider === 'cloudflare' &&
    contract.topology.routing_state === 'canonical_hostname_approved_dns_unchanged' &&
    contract.topology.commit_acknowledgement_policy === 'availability_first_async_streaming_with_measured_lag' &&
    contract.topology.recovery_point_policy === 'no_fixed_rpo_until_controlled_drill_measures_lag_and_recovery' &&
    exactKeys(evidence, EVIDENCE_KEYS) &&
    Object.entries(evidence).every(([key, value]) => VERIFIED_EVIDENCE.has(key) ? value === true : value === false) &&
    exactKeys(contract.safety_boundaries, SAFETY_KEYS) && everyFalse(contract.safety_boundaries) &&
    exactKeys(contract.implementation_state, STATE_KEYS) && everyFalse(contract.implementation_state);
}

export function reviewActivePassiveFoundation(contract) {
  if (!validateActivePassiveFoundation(contract)) {
    return { status: 'active_passive_foundation_invalid', implementation_authorized: false, reasons: ['ACTIVE_PASSIVE_FOUNDATION_INVALID'] };
  }

  return {
    status: 'active_passive_availability_first_monitoring_authorized',
    implementation_authorized: true,
    hostinger_primary: 'postgres_streaming_storage_sync_and_monitoring_verified',
    digitalocean_standby: 'private_postgres_warm_standby_verified',
    commit_acknowledgement_policy: 'availability_first_async_streaming_with_measured_lag',
    fusionpbx_or_sip_change_authorized: false,
    client_cutover_authorized: false,
    automatic_failover_enabled: false,
    reasons: [
      'FENCING_EXTERNAL_HEALTH_ROUTING_AND_DRILL_REQUIRED'
    ]
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const contract = JSON.parse(reader(join(root, CONTRACT_PATH), 'utf8'));
    const review = reviewActivePassiveFoundation(contract);
    return { code: review.status === 'active_passive_availability_first_monitoring_authorized' ? 0 : 1, stdout: `${JSON.stringify(review)}\n` };
  } catch {
    return { code: 1, stdout: '{"status":"active_passive_foundation_invalid","implementation_authorized":false,"reasons":["ACTIVE_PASSIVE_FOUNDATION_UNREADABLE"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
