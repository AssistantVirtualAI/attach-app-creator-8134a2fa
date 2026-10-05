import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewColdStandbyPromotionGate, run, validateColdStandbyPromotionGate } from './lemtel-cold-standby-promotion-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, 'infra/lemtel-resilience/cold-standby-promotion-contract.json');
const policy = () => JSON.parse(readFileSync(policyPath, 'utf8'));

test('actual contract declares only a private, restorable cold standby', () => {
  const value = policy();
  assert.equal(validateColdStandbyPromotionGate(value), true);
  assert.equal(value.topology.primary, 'hostinger_primary');
  assert.equal(value.topology.standby, 'digitalocean_standby');
  assert.equal(value.topology.standby_mode, 'cold_restorable_private');
  assert.equal(value.topology.replication_mode, 'daily_encrypted_backup_not_continuous_replication');
  assert.equal(value.topology.automatic_failover, false);
});

test('any attempt to bypass promotion, evidence, routing, or isolation preconditions fails closed', () => {
  const promotion = policy(); promotion.promotion.runtime_start_authorized = true;
  const snapshot = policy(); snapshot.evidence.fresh_backup_snapshot_checked = true;
  const database = policy(); database.evidence.database_restored_from_consistent_dump = true;
  const network = policy(); network.network.standby_public_exposure = true;
  const router = policy(); router.network.external_health_checked_routing_ready = true;
  const boundary = policy(); boundary.boundaries.fusionpbx_change = true;
  const automatic = policy(); automatic.topology.automatic_failover = true;
  for (const invalid of [promotion, snapshot, database, network, router, boundary, automatic]) {
    assert.equal(validateColdStandbyPromotionGate(invalid), false);
  }
  assert.deepEqual(reviewColdStandbyPromotionGate(network), {
    status: 'cold_standby_promotion_gate_invalid', authorization: false, reasons: ['COLD_STANDBY_PROMOTION_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'],
  });
});

test('actual gate reports no authorization to start, expose, route, or fail over', () => {
  const result = run(root);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'cold_standby_promotion_blocked');
  for (const key of ['authorization', 'runtime_start_authorized', 'public_exposure_authorized', 'dns_or_router_cutover_authorized', 'automatic_failover_authorized']) assert.equal(report[key], false, key);
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
});

test('promotion gate has no network, secret, process launch, write, restore or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-cold-standby-promotion-gate.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?|rename(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\b(?:docker|restic|pg_restore|psql|curl|wget|ssh|rsync|gh)\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
