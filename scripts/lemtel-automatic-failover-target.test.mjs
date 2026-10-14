import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewAutomaticFailoverTarget, run, validateAutomaticFailoverTarget } from './lemtel-automatic-failover-target.mjs';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, 'infra/lemtel-resilience/active-passive/automatic-failover-target-contract.json');
const policy = () => JSON.parse(readFileSync(policyPath, 'utf8'));

test('synchronous automatic-failover target is selected but remains inactive', () => {
  const value = policy();
  assert.equal(validateAutomaticFailoverTarget(value), true);
  assert.equal(value.selected_strategy.writer, 'digitalocean');
  assert.equal(value.selected_strategy.standby, 'hostinger_rebuild_as_private_hot_standby');
  assert.equal(value.selected_strategy.database_commit_policy, 'synchronous_replication_required');
  assert.equal(value.selected_strategy.storage_consistency_policy, 'write_acknowledged_only_after_dual_durable_copies');
  assert.equal(value.selected_strategy.traffic_routing, 'cloudflare_load_balancer_priority_failover');
  assert.equal(value.required_preflight.cloudflare_load_balancing_subscription_active, true);
  assert.equal(value.required_preflight.cloudflare_load_balancer_configured, false);
  assert.equal(value.required_preflight.provider_api_credentials_verified, true);
  assert.equal(value.required_preflight.independent_arbiter_deployed, true);
  assert.equal(value.required_preflight.postgres_synchronous_streaming_verified, true);
  assert.equal(value.activation.user_selected_strategy, true);
  assert.equal(value.activation.automatic_fencing_enabled, false);
  assert.equal(value.activation.automatic_promotion_enabled, false);
  assert.equal(value.activation.automatic_traffic_failover_enabled, false);
  assert.equal(value.activation.automatic_failback_enabled, false);
});

test('target rejects promotion or traffic routing before all preflights and activation', () => {
  for (const mutate of [
    (value) => { value.activation.automatic_fencing_enabled = true; },
    (value) => { value.activation.automatic_promotion_enabled = true; },
    (value) => { value.activation.automatic_traffic_failover_enabled = true; },
    (value) => { value.activation.automatic_failback_enabled = true; },
    (value) => { value.arbitration_and_fencing.promotion_on_ambiguous_health = true; },
    (value) => { value.arbitration_and_fencing.promotion_requires_verified_old_writer_fenced = false; },
    (value) => { value.required_preflight.cloudflare_load_balancing_subscription_active = false; },
    (value) => { value.boundaries.unfenced_promotion = true; },
    (value) => { value.boundaries.public_postgres_listener = true; },
  ]) {
    const value = policy();
    mutate(value);
    assert.equal(validateAutomaticFailoverTarget(value), false);
  }
});

test('verified standby and immutable digest evidence remains non-activating', () => {
  const value = policy();
  assert.equal(value.required_preflight.hostinger_private_standby_rebuilt, true);
  assert.equal(value.required_preflight.runtime_digest_parity_verified, true);
  assert.equal(validateAutomaticFailoverTarget(value), true);
  assert.equal(value.activation.automatic_promotion_enabled, false);
  assert.equal(value.activation.automatic_traffic_failover_enabled, false);
});

test('review explains the missing prerequisites without claiming activation', () => {
  const review = reviewAutomaticFailoverTarget(policy());
  assert.equal(review.status, 'synchronous_automatic_failover_target_prepared');
  assert.equal(review.activation_authorized, false);
  assert.equal(review.cloudflare_load_balancing_subscription_active, true);
  assert.equal(review.automatic_failover_enabled, false);
  assert.deepEqual(review.reasons, [
    'STORAGE_DUAL_DURABILITY_REQUIRED',
    'CLOUDFLARE_LOAD_BALANCER_NOT_CONFIGURED',
    'FAILOVER_AND_FAILBACK_DRILLS_REQUIRED',
    'FINAL_ACTIVATION_CONFIRMATION_REQUIRED'
  ]);
});

test('command is local-only and redacted', () => {
  const result = run(root);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'synchronous_automatic_failover_target_prepared');
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  const source = readFileSync(resolve(root, 'scripts/lemtel-automatic-failover-target.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|process\.env|node:(?:net|http|https|tls)|docker|ssh|curl|wget|restic|psql)\b/);
});
