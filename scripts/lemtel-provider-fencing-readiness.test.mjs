import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const contract = () => JSON.parse(read('infra/lemtel-resilience/active-passive/provider-fencing-readiness-contract.json'));

test('provider fencing readiness records read-only verification without granting a provider action', () => {
  const value = contract();
  assert.equal(value.scope, 'provider_readonly_verification_and_fencing_design_no_actions');
  assert.equal(value.verification.digitalocean_readonly_api_verified, true);
  assert.equal(value.verification.hostinger_readonly_api_verified, true);
  assert.equal(value.verification.digitalocean_fence_action_authorized, false);
  assert.equal(value.verification.hostinger_fence_action_authorized, false);
  assert.equal(value.verification.provider_mutation_executed, false);
  assert.equal(value.verification.credential_values_emitted, false);
});

test('fencing requires an ordered provider receipt and terminal state before promotion', () => {
  const value = contract();
  assert.equal(value.digitalocean_fencing.graceful_action, 'shutdown');
  assert.equal(value.digitalocean_fencing.hard_fallback_action, 'power_off');
  assert.equal(value.digitalocean_fencing.action_completion_poll_required, true);
  assert.equal(value.digitalocean_fencing.terminal_power_state_confirmation_required, true);
  assert.equal(value.hostinger_fencing.power_action, 'stop');
  assert.equal(value.hostinger_fencing.action_receipt_required, true);
  assert.equal(value.hostinger_fencing.terminal_power_state_confirmation_required, true);
  assert.equal(value.arbitration.fence_receipt_before_promotion_required, true);
});

test('fencing design fails closed and leaves every automatic action disabled', () => {
  const value = contract();
  assert.equal(value.arbitration.independent_arbiter_required, true);
  assert.equal(value.arbitration.automatic_fencing_enabled, false);
  assert.equal(value.arbitration.automatic_promotion_enabled, false);
  assert.equal(value.arbitration.automatic_traffic_failover_enabled, false);
  assert.equal(value.boundaries.single_writer_only, true);
  assert.equal(value.boundaries.no_dns_or_load_balancer_change, true);
  assert.equal(value.boundaries.no_hostinger_runtime_start, true);
  assert.equal(value.boundaries.no_telephony_change, true);
});

test('fencing guide contains no infrastructure identifiers or credential material', () => {
  const guide = read('infra/lemtel-resilience/active-passive/PROVIDER_FENCING_READINESS.md');
  assert.match(guide, /deny by default/i);
  assert.match(guide, /shutdown/);
  assert.match(guide, /power_off/);
  assert.match(guide, /\/stop/);
  assert.doesNotMatch(guide, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  assert.doesNotMatch(guide, /(?:api[_ -]?key|bearer\s+[a-z0-9]|token\s*[:=]\s*[^\s])/iu);
});
