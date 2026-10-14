// Validates the selected, but deliberately inactive, Lemtel synchronous automatic-failover target.
// It has no network, secret, process, provider, DNS, Docker, or deployment capability.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY_PATH = 'infra/lemtel-resilience/active-passive/automatic-failover-target-contract.json';

const POLICY_KEYS = ['policy_version', 'scope', 'selected_strategy', 'arbitration_and_fencing', 'required_preflight', 'activation', 'boundaries'];
const STRATEGY_KEYS = ['writer', 'standby', 'database_commit_policy', 'storage_consistency_policy', 'artifact_policy', 'traffic_routing'];
const ARBITRATION_KEYS = ['independent_arbiter_required', 'digitalocean_provider_fence_required', 'hostinger_provider_fence_required', 'promotion_requires_verified_old_writer_fenced', 'promotion_on_ambiguous_health'];
const PREFLIGHT_KEYS = ['cloudflare_load_balancing_subscription_active', 'provider_api_credentials_verified', 'independent_arbiter_deployed', 'hostinger_private_standby_rebuilt', 'postgres_synchronous_streaming_verified', 'storage_dual_durable_write_verified', 'runtime_digest_parity_verified', 'cloudflare_load_balancer_configured', 'digitalocean_fence_drill_verified', 'hostinger_promotion_drill_verified', 'reverse_failback_drill_verified', 'mobile_retry_test_verified'];
const ACTIVATION_KEYS = ['user_selected_strategy', 'automatic_fencing_enabled', 'automatic_promotion_enabled', 'automatic_traffic_failover_enabled', 'automatic_failback_enabled'];
const BOUNDARY_KEYS = ['single_writer_only', 'public_postgres_listener', 'fusionpbx_or_sip_change', 'planipret_data', 'unfenced_promotion', 'no_interruption_claim'];

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const validPreflight = (value) => Object.entries(value).every(([key, entry]) => entry === (key === 'postgres_synchronous_streaming_verified'));
const everyBoolean = (value) => Object.values(value).every((entry) => typeof entry === 'boolean');

export function validateAutomaticFailoverTarget(policy) {
  return exactKeys(policy, POLICY_KEYS) &&
    policy.policy_version === 'lemtel_synchronous_automatic_failover_target_v1' &&
    policy.scope === 'prepared_only_no_remote_activation' &&
    exactKeys(policy.selected_strategy, STRATEGY_KEYS) &&
    policy.selected_strategy.writer === 'digitalocean' &&
    policy.selected_strategy.standby === 'hostinger_rebuild_as_private_hot_standby' &&
    policy.selected_strategy.database_commit_policy === 'synchronous_replication_required' &&
    policy.selected_strategy.storage_consistency_policy === 'write_acknowledged_only_after_dual_durable_copies' &&
    policy.selected_strategy.artifact_policy === 'immutable_digest_staged_on_writer_and_standby' &&
    policy.selected_strategy.traffic_routing === 'cloudflare_load_balancer_priority_failover' &&
    exactKeys(policy.arbitration_and_fencing, ARBITRATION_KEYS) &&
    policy.arbitration_and_fencing.independent_arbiter_required === true &&
    policy.arbitration_and_fencing.digitalocean_provider_fence_required === true &&
    policy.arbitration_and_fencing.hostinger_provider_fence_required === true &&
    policy.arbitration_and_fencing.promotion_requires_verified_old_writer_fenced === true &&
    policy.arbitration_and_fencing.promotion_on_ambiguous_health === false &&
    exactKeys(policy.required_preflight, PREFLIGHT_KEYS) && everyBoolean(policy.required_preflight) &&
    policy.required_preflight.cloudflare_load_balancing_subscription_active === true &&
    exactKeys(policy.activation, ACTIVATION_KEYS) &&
    policy.activation.user_selected_strategy === true &&
    policy.activation.automatic_fencing_enabled === false &&
    policy.activation.automatic_promotion_enabled === false &&
    policy.activation.automatic_traffic_failover_enabled === false &&
    policy.activation.automatic_failback_enabled === false &&
    exactKeys(policy.boundaries, BOUNDARY_KEYS) &&
    policy.boundaries.single_writer_only === true &&
    policy.boundaries.public_postgres_listener === false &&
    policy.boundaries.fusionpbx_or_sip_change === false &&
    policy.boundaries.planipret_data === false &&
    policy.boundaries.unfenced_promotion === false &&
    policy.boundaries.no_interruption_claim === false;
}

export function reviewAutomaticFailoverTarget(policy) {
  if (!validateAutomaticFailoverTarget(policy)) {
    return { status: 'automatic_failover_target_invalid', activation_authorized: false, reasons: ['AUTOMATIC_FAILOVER_TARGET_INVALID'] };
  }
  const preflight = policy.required_preflight;
  const reasons = [
    !preflight.provider_api_credentials_verified && 'PROVIDER_FENCING_CREDENTIALS_REQUIRED',
    !preflight.independent_arbiter_deployed && 'INDEPENDENT_ARBITER_REQUIRED',
    !preflight.hostinger_private_standby_rebuilt && 'HOSTINGER_STANDBY_REBUILD_REQUIRED',
    (!preflight.postgres_synchronous_streaming_verified || !preflight.storage_dual_durable_write_verified) && 'STORAGE_DUAL_DURABILITY_REQUIRED',
    !preflight.cloudflare_load_balancer_configured && 'CLOUDFLARE_LOAD_BALANCER_NOT_CONFIGURED',
    (!preflight.digitalocean_fence_drill_verified || !preflight.hostinger_promotion_drill_verified || !preflight.reverse_failback_drill_verified) && 'FAILOVER_AND_FAILBACK_DRILLS_REQUIRED',
    'FINAL_ACTIVATION_CONFIRMATION_REQUIRED',
  ].filter(Boolean);
  return {
    status: 'synchronous_automatic_failover_target_prepared',
    activation_authorized: false,
    writer: 'digitalocean',
    standby: 'hostinger_rebuild_as_private_hot_standby',
    database_commit_policy: 'synchronous_replication_required',
    cloudflare_load_balancing_subscription_active: true,
    automatic_failover_enabled: false,
    reasons,
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const policy = JSON.parse(reader(join(root, POLICY_PATH), 'utf8'));
    const review = reviewAutomaticFailoverTarget(policy);
    return { code: review.status === 'synchronous_automatic_failover_target_prepared' ? 0 : 1, stdout: `${JSON.stringify(review)}\n` };
  } catch {
    return { code: 1, stdout: '{"status":"automatic_failover_target_invalid","activation_authorized":false,"reasons":["AUTOMATIC_FAILOVER_TARGET_UNREADABLE"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
