import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = resolve(root, 'infra/lemtel-resilience/automatic-failover');
const read = (name) => readFileSync(resolve(base, name), 'utf8');
const uncommented = (value) => value.replace(/^#.*$/gmu, '');
const stage = read('lemtel-ha-hostinger-current-topology-stage-attest.sh');
const stageBody = uncommented(stage);
const promotion = read('lemtel-ha-hostinger-current-topology-promote.sh');
const promotionBody = uncommented(promotion);
const runtime = read('lemtel-ha-hostinger-current-topology-runtime-start.sh');
const runtimeBody = uncommented(runtime);
const agent = read('lemtel-ha-hostinger-failover-agent.sh');
const service = read('lemtel-ha-hostinger-failover-agent.service');
const contract = JSON.parse(read('current-topology-contract.json'));

test('runtime-stage attestation is local, recovery-bound, and writes only current-topology evidence', () => {
  for (const expected of ['attest_current_topology_hostinger_runtime_stage', 'hostinger_private_hot_standby', 'SELECT pg_is_in_recovery()', 'runtime_stage_compose_verified=true', 'hostinger_current_topology_stage_attest_status=complete']) assert.ok(stage.includes(expected), expected);
  assert.doesNotMatch(stageBody, /(?:pg_ctl promote|cloudflare|dns_records|curl|wget|ssh|scp|rsync|fusionpbx|\bsip\b)/iu);
});

test('current-topology promotion is one-way, role-bound, fenced, and has no routing or PBX mutation', () => {
  for (const expected of [
    "LEMTEL_HA_EXECUTE:-}\" = promote_current_topology_hostinger_after_verified_fence",
    "LEMTEL_HA_ROLE:-}\" = hostinger_private_hot_standby",
    'I_UNDERSTAND_HOSTINGER_BECOMES_THE_ONLY_WRITER',
    'gpgv --keyring', 'writer_fenced=true', 'SELECT pg_is_in_recovery()',
    'pg_ctl promote', 'hostinger_current_topology_promotion_status=complete',
  ]) assert.ok(promotion.includes(expected), expected);
  assert.doesNotMatch(promotionBody, /(?:cloudflare|dns_records|curl|wget|ssh|scp|rsync|fusionpbx|\bsip\b)/iu);
  assert.doesNotMatch(promotion, /(?:digitalocean_standby|hostinger_primary)/u);
});

test('current-topology runtime activation requires the signed fence and the promoted database while keeping PostgreSQL private', () => {
  for (const expected of [
    "LEMTEL_HA_EXECUTE:-}\" = activate_current_topology_hostinger_runtime",
    "LEMTEL_HA_ROLE:-}\" = hostinger_promoted_writer",
    'I_UNDERSTAND_PROMOTED_HOSTINGER_RUNTIME_WILL_START',
    'gpgv --keyring', 'writer_fenced=true', 'promotion_executed=true',
    "SELECT pg_is_in_recovery()' | grep -qx f", 'host_postgres_listener_detected',
    'hostinger_current_topology_runtime_start_status=complete',
  ]) assert.ok(runtime.includes(expected), expected);
  assert.doesNotMatch(runtimeBody, /(?:pg_ctl promote|cloudflare|dns_records|curl|wget|ssh|scp|rsync|fusionpbx|\bsip\b)/iu);
});

test('uninstalled agent defaults to review and requires a distinct root-only acknowledgement before execute mode', () => {
  for (const expected of [
    "PROMOTION_EXECUTION_MODE', 'EXECUTION_ACK'", "mode = values.get('PROMOTION_EXECUTION_MODE', 'review')",
    "mode not in ('review', 'execute')", 'I_UNDERSTAND_CURRENT_TOPOLOGY_AUTOMATIC_FAILOVER',
    "if cfg['PROMOTION_EXECUTION_MODE'] == 'review'", 'promotion_and_runtime_completed',
    'STAGE_ATTEST = ', 'PROMOTION = ', 'RUNTIME = ',
  ]) assert.ok(agent.includes(expected), expected);
  assert.doesNotMatch(agent, /(?:source\s|eval\s|shell\s*=\s*True|DO_API_TOKEN|DO_API_BASE_URL|cloudflare\.com|\/zones\/|\/accounts\/)/iu);
  assert.match(service, /NOT installed, NOT enabled, NOT started/u);
  assert.doesNotMatch(service, /^\s*\[Install\]/mu);
});

test('prepared execution remains disabled in the authoritative contract', () => {
  assert.equal(contract.scope, 'prepared_current_topology_execution_agent_uninstalled');
  assert.equal(contract.prepared_execution_agent.default_mode, 'review');
  assert.equal(contract.prepared_execution_agent.service_installed, false);
  assert.equal(contract.prepared_execution_agent.timer_enabled, false);
  assert.equal(contract.prepared_execution_agent.execute_mode_configured, false);
  assert.ok(Object.values(contract.activation).every((value) => value === false));
});
