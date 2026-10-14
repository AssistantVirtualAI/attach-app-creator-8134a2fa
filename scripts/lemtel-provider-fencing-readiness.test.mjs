import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const contract = () => JSON.parse(read('infra/lemtel-resilience/active-passive/provider-fencing-readiness-contract.json'));

test('provider fencing records only attested read access and no provider mutation', () => {
  const value = contract();
  assert.equal(value.scope, 'provider_readonly_verification_and_fencing_design_no_actions');
  assert.equal(value.verification.digitalocean_readonly_api_verified, true);
  assert.equal(value.verification.hostinger_readonly_api_verified, false);
  assert.equal(value.verification.provider_mutation_executed, false);
  assert.equal(value.verification.credential_values_emitted, false);
});

test('fencing remains ordered, receipt-gated and fail-closed', () => {
  const value = contract();
  assert.equal(value.digitalocean_fencing.graceful_action, 'shutdown');
  assert.equal(value.digitalocean_fencing.hard_fallback_action, 'power_off');
  assert.equal(value.arbitration.fence_receipt_before_promotion_required, true);
  assert.equal(value.arbitration.automatic_fencing_enabled, false);
  assert.equal(value.arbitration.automatic_promotion_enabled, false);
  assert.equal(value.arbitration.automatic_traffic_failover_enabled, false);
});

test('fencing guide contains no infrastructure identifiers or credentials', () => {
  const guide = read('infra/lemtel-resilience/active-passive/PROVIDER_FENCING_READINESS.md');
  assert.match(guide, /refuse toute promotion/i);
  assert.doesNotMatch(guide, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  assert.doesNotMatch(guide, /(?:api[_ -]?key|bearer\s+[a-z0-9]|token\s*[:=]\s*[^\s])/iu);
});
