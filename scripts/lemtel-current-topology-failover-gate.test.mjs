import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REQUIRED_EVIDENCE_KEYS,
  evaluateCurrentTopologyFailoverGate,
  run,
  validateCurrentTopologyContract,
  validateInMemoryEvidence,
} from './lemtel-current-topology-failover-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/automatic-failover/current-topology-contract.json');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));
const completeEvidence = () => ({
  incident_id: 'lemtel-ha-20261015-a1',
  do_writer_provider_fence_attestation: true,
  hostinger_standby_recovery_streaming: true,
  storage_integrity: true,
  hostinger_runtime_staged: true,
  hostinger_runtime_stopped: true,
  no_public_postgres: true,
  single_writer_evidence: true,
  provider_fence_drill: true,
  promotion_drill: true,
  cloudflare_lb_routing: true,
  reverse_failback_drill: true,
  mobile_retry: true,
  manual_authorization: true,
});

test('current Lemtel topology is strict, private, synchronous, and non-activating', () => {
  const value = contract();
  assert.equal(validateCurrentTopologyContract(value), true);
  assert.equal(value.current_topology.writer, 'do_writer');
  assert.equal(value.current_topology.standby, 'hostinger_private_hot_standby');
  assert.equal(value.current_topology.postgresql.replication, 'synchronous');
  assert.equal(value.current_topology.postgresql.standby_state, 'recovery_streaming');
  assert.equal(value.current_topology.postgresql.public_listener, false);
  assert.equal(value.current_topology.hostinger_runtime.encrypted_staged, true);
  assert.equal(value.current_topology.hostinger_runtime.running, false);
  assert.equal(value.cloudflare.monitor_present, true);
  assert.equal(value.cloudflare.do_pool_present, true);
  assert.equal(value.cloudflare.hostinger_pool_present, true);
  assert.equal(value.cloudflare.load_balancer_present, false);
  assert.equal(value.cloudflare.routing_configured, false);
  assert.deepEqual(value.cloudflare.load_balancer_priority_when_authorized, ['do_writer', 'hostinger_private_hot_standby']);
  assert.equal(value.cloudflare.monitor_never_promotes, true);
  assert.ok(Object.values(value.fail_closed_gates).every((entry) => entry === false));
  assert.ok(Object.values(value.activation).every((entry) => entry === false));
});

test('contract rejects unsafe topology, activation, and schema changes', () => {
  for (const mutate of [
    (value) => { value.current_topology.writer = 'hostinger_primary'; },
    (value) => { value.current_topology.postgresql.replication = 'asynchronous'; },
    (value) => { value.current_topology.postgresql.public_listener = true; },
    (value) => { value.current_topology.hostinger_runtime.running = true; },
    (value) => { value.cloudflare.load_balancer_present = true; },
    (value) => { value.cloudflare.routing_configured = true; },
    (value) => { value.cloudflare.monitor_never_promotes = false; },
    (value) => { value.fail_closed_gates.do_writer_provider_fence_attestation = true; },
    (value) => { value.activation.automatic_promotion = true; },
    (value) => { value.activation.automatic_failback = true; },
    (value) => { value.boundaries.planipret_change = true; },
    (value) => { value.unexpected = true; },
  ]) {
    const value = contract();
    mutate(value);
    assert.equal(validateCurrentTopologyContract(value), false);
  }
});

test('default run is blocked with the representative unmet gates and code 78', () => {
  const result = run();
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 78);
  assert.equal(report.status, 'automatic_failover_blocked');
  assert.equal(report.automatic_failover_enabled, false);
  assert.equal(report.automatic_promotion_enabled, false);
  assert.equal(report.automatic_traffic_routing_enabled, false);
  assert.equal(report.automatic_failback_enabled, false);
  for (const reason of ['provider_fence_drill', 'promotion_drill', 'cloudflare_lb_routing', 'reverse_failback', 'mobile_retry']) {
    assert.ok(report.reasons.includes(reason), `missing representative reason: ${reason}`);
  }
});

test('partial or malformed in-memory evidence remains fail-closed', () => {
  const partial = completeEvidence();
  partial.mobile_retry = false;
  assert.equal(validateInMemoryEvidence(partial), false);
  const result = run({ contract: contract(), evidence: partial });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 78);
  assert.equal(report.status, 'automatic_failover_blocked');
  assert.ok(report.reasons.includes('mobile_retry'));
  assert.ok(report.reasons.includes('in_memory_evidence_incomplete_or_invalid'));

  const extra = completeEvidence();
  extra.unexpected = true;
  assert.equal(validateInMemoryEvidence(extra), false);
  assert.equal(evaluateCurrentTopologyFailoverGate(contract(), extra).status, 'automatic_failover_blocked');
});

test('only complete caller-supplied in-memory evidence reaches manual readiness', () => {
  const evidence = completeEvidence();
  assert.deepEqual(Object.keys(evidence).sort(), [...REQUIRED_EVIDENCE_KEYS].sort());
  assert.equal(validateInMemoryEvidence(evidence), true);
  const result = run({ contract: contract(), evidence });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.equal(report.status, 'manual_failover_readiness_evidence_complete');
  assert.equal(report.manual_action_required, true);
  assert.equal(report.automatic_failover_enabled, false);
  assert.equal(report.automatic_promotion_enabled, false);
  assert.equal(report.automatic_traffic_routing_enabled, false);
  assert.equal(report.automatic_failback_enabled, false);
  assert.deepEqual(report.reasons, []);
});

test('gate source is pure in-memory logic with no network, child command, environment, or write capability', () => {
  const source = readFileSync(resolve(root, 'scripts/lemtel-current-topology-failover-gate.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:node:(?:fs|net|http|https|tls|child_process)|fetch\s*\(|XMLHttpRequest|WebSocket|spawn\s*\(|exec(?:File)?\s*\(|process\.(?:env|argv|stdout|stderr|exit)|writeFile|appendFile|mkdir|rmSync|curl|wget|ssh)\b/u);
});
