import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluate, run } from './lemtel-hosting-preflight.mjs';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'schemas/lemtel-staging-admission/staging-admission-policy.json'), 'utf8'));
const copy = () => structuredClone(policy);

test('both the primary and standby reject the actual offline admission policy', () => {
  for (const target of ['hostinger-primary', 'digitalocean-standby']) {
    assert.deepEqual(run(['--verify', `--target=${target}`], root), {
      code: 78, stdout: 'HOSTING_BLOCKED: ADMISSION_DENIED\n',
    });
    const report = run(['--report', `--target=${target}`], root);
    assert.equal(report.code, 78);
    assert.deepEqual(JSON.parse(report.stdout), { target, status: 'blocked', reasons: ['ADMISSION_DENIED'] });
  }
});

test('missing fields, replaced version, lifted flags and stale reason codes all fail closed', () => {
  const missing = copy(); delete missing.prerequisites.private_dns_and_tls_approved;
  assert.deepEqual(evaluate(missing), ['POLICY_INVALID']);
  const version = copy(); version.policy_version = 'staging_admission_policy_v2';
  assert.deepEqual(evaluate(version), ['POLICY_UNREVIEWED']);
  const capabilities = copy(); capabilities.deployment_allowed = true;
  assert.deepEqual(evaluate(capabilities), ['POLICY_UNREVIEWED']);
  const decision = copy(); decision.current_decision = 'admitted'; decision.current_reason_codes = [];
  assert.deepEqual(evaluate(decision), ['POLICY_UNREVIEWED']);
  const omitted = copy(); omitted.current_reason_codes = [];
  assert.deepEqual(evaluate(omitted), ['POLICY_UNREVIEWED']);
  assert.deepEqual(evaluate(null), ['POLICY_INVALID']);
});

test('unknown target or operation cannot be used to invoke a deployment', () => {
  for (const args of [[], ['--deploy', '--target=hostinger-primary'], ['--verify', '--target=other'], ['--verify', '--verify']]) {
    assert.equal(run(args, root).code, 2);
  }
  assert.deepEqual(run(['--verify', '--target=hostinger-primary'], '/not/a/repo'), {
    code: 78, stdout: 'HOSTING_BLOCKED: POLICY_UNREADABLE\n',
  });
});

test('a shell automation that checks only the exit status also stops on --report', () => {
  for (const target of ['hostinger-primary', 'digitalocean-standby']) {
    assert.notEqual(run(['--report', `--target=${target}`], root).code, 0);
  }
});

test('preflight is read-only and has no execution, environment or network capability', () => {
  const code = readFileSync(resolve(root, 'scripts/lemtel-hosting-preflight.mjs'), 'utf8');
  assert.doesNotMatch(code, /child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|\.listen\s*\(|writeFile|mkdir\s*\(|process\.env|node:(?:net|http|https|tls)/);
  assert.match(code, /return \{ code: 78, stdout: `HOSTING_BLOCKED:/);
});
