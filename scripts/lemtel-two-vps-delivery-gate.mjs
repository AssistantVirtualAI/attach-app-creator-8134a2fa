// Phase 37B — validates an inactive two-VPS delivery gate only; it never deploys or contacts either VPS.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY_PATH = 'infra/lemtel-delivery/two-vps-delivery-gate.json';

const POLICY_KEYS = ['policy_version', 'scope', 'source_branch', 'initial_delivery_unit', 'artifact', 'destinations', 'resilience', 'automation'];
const ARTIFACT_KEYS = ['build_once', 'digest_required', 'same_artifact_for_standby'];
const PRIMARY_KEYS = ['target', 'order', 'deploy_authorized', 'deploy_identity_verified', 'runtime_verified', 'healthcheck_verified'];
const STANDBY_KEYS = ['target', 'order', 'deploy_authorized', 'deploy_identity_verified', 'runtime_verified', 'backups_verified', 'healthcheck_verified'];
const RESILIENCE_KEYS = ['offserver_backup_verified', 'restore_tested', 'external_failover_tested'];
const AUTOMATION_KEYS = ['github_gate_present', 'delivery_enabled', 'secrets_configured'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateTwoVpsDeliveryGate(policy) {
  if (!exactKeys(policy, POLICY_KEYS) ||
      policy.policy_version !== 'lemtel_two_vps_delivery_gate_v1' ||
      policy.scope !== 'offline_automation_gate_only' ||
      policy.source_branch !== 'lemtel/integration' ||
      policy.initial_delivery_unit !== 'lemtel_edge_functions' ||
      !exactKeys(policy.artifact, ARTIFACT_KEYS) ||
      policy.artifact.build_once !== true ||
      policy.artifact.digest_required !== true ||
      policy.artifact.same_artifact_for_standby !== true ||
      !Array.isArray(policy.destinations) || policy.destinations.length !== 2 ||
      !exactKeys(policy.resilience, RESILIENCE_KEYS) ||
      policy.resilience.offserver_backup_verified !== false ||
      policy.resilience.restore_tested !== false ||
      policy.resilience.external_failover_tested !== false ||
      !exactKeys(policy.automation, AUTOMATION_KEYS) ||
      policy.automation.github_gate_present !== true ||
      policy.automation.delivery_enabled !== false ||
      policy.automation.secrets_configured !== false) return false;

  const [primary, standby] = policy.destinations;
  return exactKeys(primary, PRIMARY_KEYS) && primary.target === 'hostinger_primary' && primary.order === 1 &&
    primary.deploy_authorized === false && primary.deploy_identity_verified === false && primary.runtime_verified === false && primary.healthcheck_verified === false &&
    exactKeys(standby, STANDBY_KEYS) && standby.target === 'digitalocean_standby' && standby.order === 2 &&
    standby.deploy_authorized === false && standby.deploy_identity_verified === false && standby.runtime_verified === false && standby.backups_verified === false && standby.healthcheck_verified === false;
}

export function reviewTwoVpsDeliveryGate(policy) {
  if (!validateTwoVpsDeliveryGate(policy)) {
    return { status: 'two_vps_delivery_gate_invalid', authorization: false, reasons: ['TWO_VPS_DELIVERY_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'two_vps_delivery_blocked',
    authorization: false,
    hostinger_deployment_authorized: false,
    digitalocean_deployment_authorized: false,
    delivery_enabled: false,
    automatic_failover_authorized: false,
    reasons: [
      'RESTRICTED_DEPLOY_IDENTITIES_REQUIRED',
      'DIGITALOCEAN_RUNTIME_AND_AUTOMATED_BACKUP_REQUIRED',
      'OFFSERVER_BACKUP_AND_RESTORE_TEST_REQUIRED',
      'SAME_ARTIFACT_DIGEST_AND_TWO_HEALTHCHECKS_REQUIRED',
      'GITHUB_ENVIRONMENT_SECRETS_AND_EXPLICIT_ACTIVATION_REQUIRED',
      'EXTERNAL_FAILOVER_AND_FAILBACK_TEST_REQUIRED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const policy = JSON.parse(reader(join(root, POLICY_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewTwoVpsDeliveryGate(policy))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"two_vps_delivery_gate_invalid","authorization":false,"reasons":["TWO_VPS_DELIVERY_GATE_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
