import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewEdgeFunctionDeploymentPackage, run, validateEdgeFunctionDeploymentPackage } from './lemtel-self-hosted-edge-function-package.mjs';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'infra/lemtel-self-hosted/edge-functions/deployment-manifest.json');
const pkg = () => JSON.parse(readFileSync(manifestPath, 'utf8'));

test('actual package seals exactly the two Lemtel-only Edge Function sources while denying deployment', () => {
  const value = pkg();
  assert.equal(validateEdgeFunctionDeploymentPackage(value, root), true);
  assert.equal(value.deployment_authorized, false);
  assert.equal(value.secrets_in_bundle, false);
  assert.deepEqual(value.functions.map((entry) => entry.slug), ['lemtel-mobile-config-admin', 'lemtel-mobile-config-manifest']);
  assert.deepEqual(value.functions.map((entry) => entry.destination), ['lemtel-mobile-config-admin/index.ts', 'lemtel-mobile-config-manifest/index.ts']);
});

test('tampered source identities, missing runtime router requirements and authorization lifts fail closed', () => {
  const tamperedDigest = pkg(); tamperedDigest.functions[0].source_sha256 = '0'.repeat(64);
  const untrustedSource = pkg(); untrustedSource.functions[1].source = 'supabase/functions/mobile-config-admin/index.ts';
  const badDestination = pkg(); badDestination.functions[0].destination = 'main/index.ts';
  const missingRouter = pkg(); missingRouter.required_runtime_paths = ['deno.jsonc'];
  const deploymentLifted = pkg(); deploymentLifted.deployment_authorized = true;
  const restartLifted = pkg(); restartLifted.runtime.post_copy_action = 'restart_now';
  for (const invalid of [tamperedDigest, untrustedSource, badDestination, missingRouter, deploymentLifted, restartLifted]) {
    assert.equal(validateEdgeFunctionDeploymentPackage(invalid, root), false);
  }
});

test('actual package remains offline-only and emits no source digests or deployment authorization', () => {
  const result = run(root);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'edge_function_package_offline_ready');
  assert.equal(report.authorization, false);
  assert.equal(report.external_write_authorized, false);
  assert.equal(report.functions_restart_authorized, false);
  assert.deepEqual(report.functions, ['lemtel-mobile-config-admin', 'lemtel-mobile-config-manifest']);
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}/u);
});

test('package validator has no network, environment, process launch, copy, write or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-edge-function-package.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?|rename(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|\bssh\b|\brsync\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
