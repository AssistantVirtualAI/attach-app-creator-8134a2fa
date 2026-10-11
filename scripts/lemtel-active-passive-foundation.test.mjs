import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewActivePassiveFoundation, run, validateActivePassiveFoundation } from './lemtel-active-passive-foundation.mjs';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/active-passive/contract.json');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));

test('active-passive foundation records the approved availability-first single-writer topology without telephony', () => {
  const value = contract();
  assert.equal(validateActivePassiveFoundation(value), true);
  assert.equal(value.authorization.active_passive_implementation_authorized, true);
  assert.equal(value.authorization.fusionpbx_or_sip_activation_authorized, false);
  assert.equal(value.topology.primary, 'hostinger_primary');
  assert.equal(value.topology.standby, 'digitalocean_warm_standby');
  assert.equal(value.topology.writer_policy, 'single_writer_hostinger');
  assert.equal(value.topology.canonical_public_hostname, 'lemtel.assistantvirtualai.com');
  assert.equal(value.topology.routing_provider, 'cloudflare');
  assert.equal(value.topology.routing_state, 'canonical_hostname_approved_dns_unchanged');
  assert.equal(value.topology.commit_acknowledgement_policy, 'availability_first_async_streaming_with_measured_lag');
  assert.equal(value.required_evidence.hostinger_admin_ssh_verified, true);
  assert.equal(value.required_evidence.digitalocean_admin_ssh_verified, true);
  assert.equal(value.required_evidence.standby_basebackup_verified, true);
  assert.equal(value.required_evidence.replication_lag_monitoring_verified, true);
  assert.equal(value.required_evidence.storage_integrity_monitoring_verified, true);
  assert.equal(value.required_evidence.standby_runtime_config_staged, true);
});

test('foundation refuses synchronous acknowledgement, unsafe promotion, plaintext secret copying, shared-business data, and premature live routing', () => {
  for (const mutate of [
    (value) => { value.topology.commit_acknowledgement_policy = 'durability_first_synchronous_replication'; },
    (value) => { value.safety_boundaries.automatic_promotion_without_fencing = true; },
    (value) => { value.safety_boundaries.plaintext_secret_replication = true; },
    (value) => { value.authorization.planipret_data_in_scope = true; },
    (value) => { value.authorization.fusionpbx_or_sip_activation_authorized = true; },
    (value) => { value.topology.routing_state = 'dns_cutover_complete'; },
    (value) => { value.implementation_state.dns_failover_enabled = true; },
    (value) => { value.required_evidence.failover_drill_verified = true; },
  ]) {
    const value = contract();
    mutate(value);
    assert.equal(validateActivePassiveFoundation(value), false);
  }
});

test('foundation records monitoring progress without misrepresenting failover readiness', () => {
  const review = reviewActivePassiveFoundation(contract());
  assert.equal(review.status, 'active_passive_availability_first_monitoring_authorized');
  assert.equal(review.implementation_authorized, true);
  assert.equal(review.automatic_failover_enabled, false);
  assert.equal(review.fusionpbx_or_sip_change_authorized, false);
  assert.equal(review.commit_acknowledgement_policy, 'availability_first_async_streaming_with_measured_lag');
});

test('command reports the approved monitored state and has no external capability', () => {
  const result = run(root);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'active_passive_availability_first_monitoring_authorized');
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  const source = readFileSync(resolve(root, 'scripts/lemtel-active-passive-foundation.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|process\.env|node:(?:net|http|https|tls)|docker|ssh|curl|wget|restic|psql)\b/);
});
