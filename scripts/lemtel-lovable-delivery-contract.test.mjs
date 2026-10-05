import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewDeliveryContract, run, validateDeliveryContract } from './lemtel-lovable-delivery-contract.mjs';

const repo = resolve(import.meta.dirname, '..');
const contract = () => ({
  contract_version: 'lemtel_lovable_github_delivery_v2',
  scope: 'offline_delivery_contract_only',
  source: {
    canonical_repository: 'github', lovable_git_sync: 'two_way_isolated_branch_only',
    lovable_active_branch: 'lemtel/lovable-sync', lovable_branch_base: 'lemtel/integration',
    github_branch_same_as_lovable: true,
    lovable_to_integration: 'pull_request_only', lovable_configuration_authorized: false,
    direct_lovable_to_hostinger: false, direct_lovable_to_digitalocean: false,
  },
  artifact: {
    build_once: true, immutable_identity: ['git_sha', 'container_digest'], rebuild_on_standby: false,
    checksum_match_required: true, source_maps_private: true,
  },
  promotion: [
    { target: 'hostinger_primary', order: 1, requires: ['ci_passed', 'fresh_snapshot', 'restricted_deploy_identity', 'healthcheck'] },
    { target: 'digitalocean_standby', order: 2, requires: ['hostinger_artifact_verified', 'same_artifact_digest', 'restricted_deploy_identity', 'healthcheck'] },
  ],
  automation: { workflow_enabled: false, deploy_authorized: false, secrets_configured: false, target_access_verified: false },
  failover: { automatic: false, requires: ['replicated_data', 'tested_restore', 'external_health_checked_routing', 'failover_and_failback_test'] },
  client_cutover: { authorized: false, requires: ['new_publishable_key', 'new_auth_accounts', 'deployed_backend_contracts', 'physical_device_tests'] },
});

test('valid contract reserves Lovable two-way sync to an isolated Lemtel branch but never authorizes a switch or delivery', () => {
  const result = reviewDeliveryContract(contract());
  assert.equal(result.status, 'delivery_contract_offline_ready');
  for (const key of ['authorization', 'lovable_branch_switch_authorized', 'github_deployment_enabled', 'hostinger_deployment_authorized', 'digitalocean_deployment_authorized', 'automatic_failover_authorized', 'client_cutover_authorized']) {
    assert.equal(result[key], false, key);
  }
});

test('Planipret, arbitrary Lovable branches, direct host pushes, standby rebuilds and authorization lifts fail closed', () => {
  const planipret = contract(); planipret.source.lovable_active_branch = 'Planipret';
  const arbitrary = contract(); arbitrary.source.lovable_active_branch = 'main';
  const divergent = contract(); divergent.source.github_branch_same_as_lovable = false;
  const switchLifted = contract(); switchLifted.source.lovable_configuration_authorized = true;
  const direct = contract(); direct.source.direct_lovable_to_hostinger = true;
  const rebuild = contract(); rebuild.artifact.rebuild_on_standby = true;
  const enabled = contract(); enabled.automation.workflow_enabled = true;
  const failover = contract(); failover.failover.automatic = true;
  const missingDigest = contract(); missingDigest.promotion[1].requires = ['hostinger_artifact_verified', 'restricted_deploy_identity', 'healthcheck'];
  for (const invalid of [planipret, arbitrary, divergent, switchLifted, direct, rebuild, enabled, failover, missingDigest]) assert.equal(validateDeliveryContract(invalid), false);
  assert.deepEqual(reviewDeliveryContract(enabled), {
    status: 'delivery_contract_invalid', authorization: false, reasons: ['DELIVERY_CONTRACT_INVALID', 'MANUAL_REVIEW_REQUIRED'],
  });
});

test('actual contract remains offline-only and denies branch switching and automation', () => {
  const result = run(repo);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'delivery_contract_offline_ready');
  assert.equal(report.lovable_branch_switch_authorized, false);
  assert.equal(report.github_deployment_enabled, false);
  assert.equal(report.automatic_failover_authorized, false);
});

test('delivery contract validator has no network, process launch, write, environment or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-lovable-delivery-contract.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|\bssh\b|\brsync\b|\bgh\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
