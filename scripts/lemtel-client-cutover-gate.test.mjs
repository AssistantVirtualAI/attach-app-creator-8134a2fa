import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewClientCutoverGate, run, validateClientCutoverGate } from './lemtel-client-cutover-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, 'infra/lemtel-client-cutover/client-cutover-gate.json');
const policy = () => JSON.parse(readFileSync(policyPath, 'utf8'));

test('actual policy preserves legacy installed clients and denies all Lemtel self-hosted cutover actions', () => {
  const value = policy();
  assert.equal(validateClientCutoverGate(value), true);
  assert.equal(value.current_state.installed_clients_remain_on_legacy_backend, true);
  assert.equal(value.current_state.self_hosted_client_cutover_authorized, false);
  assert.equal(value.current_state.planipret_branch_eligible, false);
  assert.equal(value.current_state.current_lovable_project_eligible, false);
  assert.equal(value.build_preconditions.source_maps_private, true);
});

test('any backend claim, client build, device assertion, Lovable connection, store submission or rollout lift fails closed', () => {
  const backend = policy(); backend.backend_preconditions.edge_functions_deployed_and_smoke_tested = true;
  const build = policy(); build.build_preconditions.ios_build_authorized = true;
  const device = policy(); device.device_validation.android_physical_test_passed = true;
  const lovable = policy(); lovable.rollout.lovable_lemtel_project_connected = true;
  const store = policy(); store.rollout.store_submission_authorized = true;
  const rollout = policy(); rollout.rollout.production_rollout_authorized = true;
  const legacy = policy(); legacy.current_state.installed_clients_remain_on_legacy_backend = false;
  for (const invalid of [backend, build, device, lovable, store, rollout, legacy]) assert.equal(validateClientCutoverGate(invalid), false);
  assert.deepEqual(reviewClientCutoverGate(build), {
    status: 'client_cutover_gate_invalid', authorization: false, reasons: ['CLIENT_CUTOVER_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'],
  });
});

test('actual gate grants no build, configuration, store, or production authorization', () => {
  const result = run(root);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'client_cutover_blocked');
  for (const key of ['authorization', 'desktop_build_authorized', 'ios_build_authorized', 'android_build_authorized', 'client_configuration_write_authorized', 'store_submission_authorized', 'production_rollout_authorized']) assert.equal(report[key], false, key);
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
});

test('cutover gate has no network, build, signing, package, secret, write or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-client-cutover-gate.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?|rename(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\b(?:docker|npm|pnpm|npx|xcodebuild|gradle|codesign|notarytool|fastlane|curl|wget|ssh|rsync|gh)\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
