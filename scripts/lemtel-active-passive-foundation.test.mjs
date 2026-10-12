import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewActivePassiveFoundation, run, validateActivePassiveFoundation } from './lemtel-active-passive-foundation.mjs';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/active-passive/contract.json');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));

test('active-passive contract records the verified controlled drill without telephony', () => {
  const value = contract();
  assert.equal(validateActivePassiveFoundation(value), true);
  assert.equal(value.authorization.active_passive_implementation_authorized, true);
  assert.equal(value.authorization.client_cutover_authorized, true);
  assert.equal(value.authorization.fusionpbx_or_sip_activation_authorized, false);
  assert.equal(value.topology.primary, 'digitalocean_promoted_writer_during_controlled_drill');
  assert.equal(value.topology.standby, 'hostinger_fenced_former_primary');
  assert.equal(value.topology.writer_policy, 'single_writer_digitalocean_during_controlled_drill');
  assert.equal(value.topology.canonical_public_hostname, 'lemtel.assistantvirtualai.com');
  assert.equal(value.topology.routing_provider, 'cloudflare');
  assert.equal(value.topology.routing_state, 'canonical_digitalocean_route_live_controlled_drill');
  assert.equal(value.required_evidence.fencing_verified, true);
  assert.equal(value.required_evidence.promoted_writer_readwrite_verified, true);
  assert.equal(value.required_evidence.failover_drill_verified, true);
  assert.equal(value.required_evidence.failback_drill_verified, false);
  assert.equal(value.implementation_state.remote_runtime_enabled, true);
  assert.equal(value.implementation_state.dns_failover_enabled, true);
  assert.equal(value.implementation_state.automatic_failover_enabled, false);
});

test('controlled drill contract rejects unsafe boundaries and a premature failback claim', () => {
  for (const mutate of [
    (value) => { value.topology.writer_policy = 'multiple_writers'; },
    (value) => { value.safety_boundaries.automatic_promotion_without_fencing = true; },
    (value) => { value.safety_boundaries.plaintext_secret_replication = true; },
    (value) => { value.authorization.planipret_data_in_scope = true; },
    (value) => { value.authorization.fusionpbx_or_sip_activation_authorized = true; },
    (value) => { value.required_evidence.fencing_verified = false; },
    (value) => { value.required_evidence.failback_drill_verified = true; },
    (value) => { value.implementation_state.automatic_failover_enabled = true; },
  ]) {
    const value = contract();
    mutate(value);
    assert.equal(validateActivePassiveFoundation(value), false);
  }
});

test('drill review distinguishes successful cutover from required failback and telephony work', () => {
  const review = reviewActivePassiveFoundation(contract());
  assert.equal(review.status, 'active_passive_controlled_failover_drill_verified');
  assert.equal(review.implementation_authorized, true);
  assert.equal(review.client_cutover_authorized, true);
  assert.equal(review.automatic_failover_enabled, false);
  assert.equal(review.fusionpbx_or_sip_change_authorized, false);
  assert.deepEqual(review.reasons, [
    'CONTROLLED_FAILBACK_REQUIRED_BEFORE_HOSTINGER_WRITER_RESTART',
    'AUTHENTICATED_CLIENT_TESTS_PENDING',
    'TELEPHONY_DETAILS_REQUIRED',
  ]);
});

test('command reports the verified drill state and has no external capability', () => {
  const result = run(root);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'active_passive_controlled_failover_drill_verified');
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  const source = readFileSync(resolve(root, 'scripts/lemtel-active-passive-foundation.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|process\.env|node:(?:net|http|https|tls)|docker|ssh|curl|wget|restic|psql)\b/);
});
