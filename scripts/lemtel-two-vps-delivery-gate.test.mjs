import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewTwoVpsDeliveryGate, run, validateTwoVpsDeliveryGate } from './lemtel-two-vps-delivery-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, 'infra/lemtel-delivery/two-vps-delivery-gate.json');
const policy = () => JSON.parse(readFileSync(policyPath, 'utf8'));

test('actual policy blocks two-VPS delivery while retaining a single immutable-artifact contract', () => {
  const value = policy();
  assert.equal(validateTwoVpsDeliveryGate(value), true);
  assert.equal(value.source_branch, 'lemtel/integration');
  assert.deepEqual(value.artifact, { build_once: true, digest_required: true, same_artifact_for_standby: true });
  assert.equal(value.automation.delivery_enabled, false);
});

test('Planipret, any deploy lift, a missing DigitalOcean backup or a standby rebuild contract fail closed', () => {
  const planipret = policy(); planipret.source_branch = 'Planipret';
  const hostingerLifted = policy(); hostingerLifted.destinations[0].deploy_authorized = true;
  const standbyLifted = policy(); standbyLifted.destinations[1].deploy_authorized = true;
  const backupLifted = policy(); backupLifted.destinations[1].backups_verified = true;
  const deliveryLifted = policy(); deliveryLifted.automation.delivery_enabled = true;
  const rebuildStandby = policy(); rebuildStandby.artifact.same_artifact_for_standby = false;
  for (const invalid of [planipret, hostingerLifted, standbyLifted, backupLifted, deliveryLifted, rebuildStandby]) {
    assert.equal(validateTwoVpsDeliveryGate(invalid), false);
  }
  assert.deepEqual(reviewTwoVpsDeliveryGate(deliveryLifted), {
    status: 'two_vps_delivery_gate_invalid', authorization: false, reasons: ['TWO_VPS_DELIVERY_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'],
  });
});

test('actual gate remains blocked and does not expose resources or enable failover', () => {
  const result = run(root);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'two_vps_delivery_blocked');
  for (const key of ['authorization', 'hostinger_deployment_authorized', 'digitalocean_deployment_authorized', 'delivery_enabled', 'automatic_failover_authorized']) assert.equal(report[key], false, key);
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
});

test('delivery gate has no network, secret, process launch, write or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-two-vps-delivery-gate.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?|rename(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|\bssh\b|\brsync\b|\bgh\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
