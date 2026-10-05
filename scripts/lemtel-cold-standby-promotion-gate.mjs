// Phase 38A — validates an inactive cold-standby promotion contract only.
// This module never contacts, starts, exposes, restores, or changes either VPS.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY_PATH = 'infra/lemtel-resilience/cold-standby-promotion-contract.json';

const POLICY_KEYS = ['policy_version', 'scope', 'topology', 'promotion', 'evidence', 'network', 'boundaries'];
const TOPOLOGY_KEYS = ['primary', 'standby', 'standby_mode', 'replication_mode', 'automatic_failover'];
const PROMOTION_KEYS = ['authorized', 'incident_owner_confirmed', 'approved_runbook_confirmed', 'runtime_start_authorized', 'public_exposure_authorized', 'dns_or_router_cutover_authorized'];
const EVIDENCE_KEYS = ['fresh_backup_snapshot_checked', 'restic_integrity_check_passed', 'restore_test_passed', 'exact_compose_provenance_verified', 'image_digest_manifest_match', 'configuration_compatibility_verified', 'database_restored_from_consistent_dump', 'database_import_validated', 'private_healthchecks_passed', 'external_healthchecks_passed', 'rollback_ready', 'failback_plan_validated'];
const NETWORK_KEYS = ['database_public_exposure', 'standby_public_exposure', 'external_health_checked_routing_ready', 'separate_standby_hostnames_verified'];
const BOUNDARY_KEYS = ['planipret_data_copy', 'fusionpbx_change', 'delivery_automation_enabled'];

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const allFalse = (value) => Object.values(value).every((entry) => entry === false);

export function validateColdStandbyPromotionGate(policy) {
  return exactKeys(policy, POLICY_KEYS) &&
    policy.policy_version === 'lemtel_cold_standby_promotion_v1' &&
    policy.scope === 'offline_cold_standby_promotion_gate_only' &&
    exactKeys(policy.topology, TOPOLOGY_KEYS) &&
    policy.topology.primary === 'hostinger_primary' &&
    policy.topology.standby === 'digitalocean_standby' &&
    policy.topology.standby_mode === 'cold_restorable_private' &&
    policy.topology.replication_mode === 'daily_encrypted_backup_not_continuous_replication' &&
    policy.topology.automatic_failover === false &&
    exactKeys(policy.promotion, PROMOTION_KEYS) && allFalse(policy.promotion) &&
    exactKeys(policy.evidence, EVIDENCE_KEYS) && allFalse(policy.evidence) &&
    exactKeys(policy.network, NETWORK_KEYS) && allFalse(policy.network) &&
    exactKeys(policy.boundaries, BOUNDARY_KEYS) && allFalse(policy.boundaries);
}

export function reviewColdStandbyPromotionGate(policy) {
  if (!validateColdStandbyPromotionGate(policy)) {
    return { status: 'cold_standby_promotion_gate_invalid', authorization: false, reasons: ['COLD_STANDBY_PROMOTION_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'cold_standby_promotion_blocked',
    authorization: false,
    runtime_start_authorized: false,
    public_exposure_authorized: false,
    dns_or_router_cutover_authorized: false,
    automatic_failover_authorized: false,
    reasons: [
      'FRESH_ENCRYPTED_BACKUP_AND_RESTIC_INTEGRITY_CHECK_REQUIRED',
      'RESTORE_TEST_AND_CONSISTENT_DATABASE_IMPORT_VALIDATION_REQUIRED',
      'EXACT_COMPOSE_PROVENANCE_AND_IMAGE_DIGEST_MATCH_REQUIRED',
      'SEPARATE_STANDBY_HOSTNAMES_AND_PRIVATE_HEALTHCHECKS_REQUIRED',
      'EXTERNAL_HEALTH_CHECKED_ROUTING_AND_PUBLIC_HEALTHCHECKS_REQUIRED',
      'ROLLBACK_AND_FAILBACK_VALIDATION_REQUIRED',
      'EXPLICIT_INCIDENT_OWNER_AUTHORIZATION_REQUIRED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const policy = JSON.parse(reader(join(root, POLICY_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewColdStandbyPromotionGate(policy))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"cold_standby_promotion_gate_invalid","authorization":false,"reasons":["COLD_STANDBY_PROMOTION_GATE_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
