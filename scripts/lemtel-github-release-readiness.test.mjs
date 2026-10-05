import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewGitHubReleaseReadiness, run, validateGitHubReleaseReadiness } from './lemtel-github-release-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, 'infra/lemtel-delivery/github-release-readiness.json');
const policy = () => JSON.parse(readFileSync(policyPath, 'utf8'));

test('actual policy reserves an immutable Lemtel-only release pipeline but leaves it inactive', () => {
  const value = policy();
  assert.equal(validateGitHubReleaseReadiness(value), true);
  assert.equal(value.source.accepted_branch, 'lemtel/integration');
  assert.deepEqual(value.source.rejected_branches, ['Planipret']);
  assert.deepEqual(value.artifact.immutable_identity, ['git_sha', 'artifact_sha256']);
  assert.equal(value.pipeline.workflow_enabled, false);
  assert.equal(value.pipeline.external_write_authorized, false);
});

test('Planipret, current Lovable eligibility, secret configuration, build activation, or external writes fail closed', () => {
  const planipret = policy(); planipret.source.accepted_branch = 'Planipret';
  const lovable = policy(); lovable.source.current_lovable_project_eligible = true;
  const hostinger = policy(); hostinger.environments[0].configured = true;
  const build = policy(); build.pipeline.artifact_generation_authorized = true;
  const sync = policy(); sync.pipeline.standby_artifact_sync_authorized = true;
  const write = policy(); write.pipeline.external_write_authorized = true;
  const standalone = policy(); standalone.artifact.standby_rebuild = true;
  for (const invalid of [planipret, lovable, hostinger, build, sync, write, standalone]) assert.equal(validateGitHubReleaseReadiness(invalid), false);
  assert.deepEqual(reviewGitHubReleaseReadiness(write), {
    status: 'github_release_readiness_invalid', authorization: false, reasons: ['GITHUB_RELEASE_READINESS_INVALID', 'MANUAL_REVIEW_REQUIRED'],
  });
});

test('actual gate authorizes no artifact build, GitHub setup, deployment, sync, or runtime write', () => {
  const result = run(root);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'github_release_readiness_blocked');
  for (const key of ['authorization', 'artifact_generation_authorized', 'github_environment_configuration_authorized', 'hostinger_deployment_authorized', 'digitalocean_artifact_sync_authorized', 'digitalocean_runtime_write_authorized']) assert.equal(report[key], false, key);
  assert.doesNotMatch(result.stdout, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
});

test('readiness gate has no network, secret, process launch, write, build, package, or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-github-release-readiness.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?|rename(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\b(?:docker|npm|pnpm|npx|curl|wget|ssh|rsync|gh)\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
