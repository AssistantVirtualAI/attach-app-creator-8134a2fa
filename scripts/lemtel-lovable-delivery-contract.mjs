// Phases 36A/36B — validates an offline delivery contract only; it never deploys or contacts a host.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CONTRACT_PATH = 'infra/lemtel-delivery/contract.json';

const CONTRACT_KEYS = ['contract_version', 'scope', 'source', 'artifact', 'promotion', 'automation', 'failover', 'client_cutover'];
const SOURCE_KEYS = ['canonical_repository', 'lovable_git_sync', 'lovable_active_branch', 'github_branch_same_as_lovable', 'lovable_branch_base', 'lovable_to_integration', 'lovable_configuration_authorized', 'direct_lovable_to_hostinger', 'direct_lovable_to_digitalocean'];
const ARTIFACT_KEYS = ['build_once', 'immutable_identity', 'rebuild_on_standby', 'checksum_match_required', 'source_maps_private'];
const PROMOTION_KEYS = ['target', 'order', 'requires'];
const AUTOMATION_KEYS = ['workflow_enabled', 'deploy_authorized', 'secrets_configured', 'target_access_verified'];
const FAILOVER_KEYS = ['automatic', 'requires'];
const CLIENT_CUTOVER_KEYS = ['authorized', 'requires'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const includesAll = (value, expected) => Array.isArray(value) && expected.every((item) => value.includes(item));
const isIsolatedLovableBranch = (value) => typeof value === 'string' && /^lemtel\/lovable-[a-z0-9][a-z0-9-]{1,62}$/u.test(value);

export function validateDeliveryContract(contract) {
  if (!exactKeys(contract, CONTRACT_KEYS) ||
      contract.contract_version !== 'lemtel_lovable_github_delivery_v2' ||
      contract.scope !== 'offline_delivery_contract_only' ||
      !exactKeys(contract.source, SOURCE_KEYS) ||
      contract.source.canonical_repository !== 'github' ||
      contract.source.lovable_git_sync !== 'two_way_isolated_branch_only' ||
      !isIsolatedLovableBranch(contract.source.lovable_active_branch) ||
      contract.source.github_branch_same_as_lovable !== true ||
      contract.source.lovable_branch_base !== 'lemtel/integration' ||
      contract.source.lovable_to_integration !== 'pull_request_only' ||
      contract.source.lovable_configuration_authorized !== false ||
      contract.source.direct_lovable_to_hostinger !== false ||
      contract.source.direct_lovable_to_digitalocean !== false ||
      !exactKeys(contract.artifact, ARTIFACT_KEYS) ||
      contract.artifact.build_once !== true ||
      contract.artifact.rebuild_on_standby !== false ||
      contract.artifact.checksum_match_required !== true ||
      contract.artifact.source_maps_private !== true ||
      !includesAll(contract.artifact.immutable_identity, ['git_sha', 'container_digest']) ||
      !Array.isArray(contract.promotion) || contract.promotion.length !== 2 ||
      !exactKeys(contract.automation, AUTOMATION_KEYS) ||
      contract.automation.workflow_enabled !== false ||
      contract.automation.deploy_authorized !== false ||
      contract.automation.secrets_configured !== false ||
      contract.automation.target_access_verified !== false ||
      !exactKeys(contract.failover, FAILOVER_KEYS) || contract.failover.automatic !== false ||
      !exactKeys(contract.client_cutover, CLIENT_CUTOVER_KEYS) || contract.client_cutover.authorized !== false) return false;

  const [primary, standby] = contract.promotion;
  if (!exactKeys(primary, PROMOTION_KEYS) || !exactKeys(standby, PROMOTION_KEYS) ||
      primary.target !== 'hostinger_primary' || primary.order !== 1 ||
      standby.target !== 'digitalocean_standby' || standby.order !== 2 ||
      !includesAll(primary.requires, ['ci_passed', 'fresh_snapshot', 'restricted_deploy_identity', 'healthcheck']) ||
      !includesAll(standby.requires, ['hostinger_artifact_verified', 'same_artifact_digest', 'restricted_deploy_identity', 'healthcheck']) ||
      !includesAll(contract.failover.requires, ['replicated_data', 'tested_restore', 'external_health_checked_routing', 'failover_and_failback_test']) ||
      !includesAll(contract.client_cutover.requires, ['new_publishable_key', 'new_auth_accounts', 'deployed_backend_contracts', 'physical_device_tests'])) return false;

  return true;
}

export function reviewDeliveryContract(contract) {
  if (!validateDeliveryContract(contract)) {
    return { status: 'delivery_contract_invalid', authorization: false, reasons: ['DELIVERY_CONTRACT_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'delivery_contract_offline_ready',
    authorization: false,
    lovable_branch_switch_authorized: false,
    github_deployment_enabled: false,
    hostinger_deployment_authorized: false,
    digitalocean_deployment_authorized: false,
    automatic_failover_authorized: false,
    client_cutover_authorized: false,
    reasons: [
      'ISOLATED_LOVABLE_BRANCH_CREATION_AND_SWITCH_APPROVAL_REQUIRED',
      'GITHUB_PULL_REQUEST_GATE_REQUIRED',
      'GITHUB_ACTIONS_ENVIRONMENT_AND_SECRET_SETUP_REQUIRED',
      'RESTRICTED_DEPLOY_IDENTITIES_REQUIRED',
      'FRESH_SNAPSHOT_AND_OFFSERVER_BACKUP_REQUIRED',
      'SAME_IMMUTABLE_ARTIFACT_MUST_REACH_PRIMARY_AND_STANDBY',
      'REPLICATION_AND_EXTERNAL_FAILOVER_TEST_REQUIRED',
      'CLIENT_CUTOVER_NOT_AUTHORIZED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const contract = JSON.parse(reader(join(root, CONTRACT_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewDeliveryContract(contract))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"delivery_contract_invalid","authorization":false,"reasons":["DELIVERY_CONTRACT_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
