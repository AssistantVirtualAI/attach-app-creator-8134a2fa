import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_ACTIONS, FORBIDDEN_ACTIONS, evaluate, run } from './lemtel-hostinger-empty-staging-admission.mjs';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'schemas/lemtel-hostinger-empty-staging/policy.json'), 'utf8'));
const beforeExpiry = Date.parse(policy.expires_at) - 1;
const copy = () => structuredClone(policy);

test('the approved Hostinger empty-staging scope is admitted only before its expiry', () => {
  assert.deepEqual(evaluate(policy, beforeExpiry), ['HOSTINGER_EMPTY_STAGING_ADMITTED']);
  assert.deepEqual(run(['--verify'], root, beforeExpiry), { code: 0, stdout: 'HOSTINGER_EMPTY_STAGING_ADMITTED\n' });
  const report = run(['--report'], root, beforeExpiry);
  assert.equal(report.code, 0);
  assert.deepEqual(JSON.parse(report.stdout), {
    target: 'hostinger-primary', scope: 'empty_staging_only', status: 'admitted',
    authorization: 'manual_staging_commands_only', reasons: ['HOSTINGER_EMPTY_STAGING_ADMITTED'],
  });
});

test('expiry and every missing authorization prerequisite fail closed', () => {
  assert.deepEqual(evaluate(policy, Date.parse(policy.expires_at)), ['AUTHORIZATION_EXPIRED']);
  for (const key of ['snapshot_current_checked', 'monitoring_owner_confirmed', 'secrets_owner_confirmed']) {
    const altered = copy(); altered[key] = false;
    assert.deepEqual(evaluate(altered, beforeExpiry), [`unmet_${key}`]);
  }
});

test('no list expansion, scope change, retention change or malformed policy is admitted', () => {
  for (const [key, value] of [
    ['scope', 'production'], ['logs_retention_days', 31],
    ['allowed_actions', [...ALLOWED_ACTIONS, 'migrate_data']],
    ['forbidden_actions', FORBIDDEN_ACTIONS.slice(1)],
    ['decision', 'denied'], ['admission_ref', 'short'],
  ]) {
    const altered = copy(); altered[key] = value;
    assert.deepEqual(evaluate(altered, beforeExpiry), ['POLICY_INVALID']);
  }
  const blocked = run(['--report'], '/missing', beforeExpiry);
  assert.equal(blocked.code, 78);
  assert.match(blocked.stdout, /POLICY_UNREADABLE/);
  assert.equal(run(['--deploy'], root, beforeExpiry).code, 2);
});

test('admission guard has no network, environment, subprocess, Docker invocation or write capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-hostinger-empty-staging-admission.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|\.listen\s*\(|writeFile|mkdir\s*\(|process\.env|node:(?:net|http|https|tls)|docker\s+(?:run|compose|build|pull)|apt(?:-get)?\s+install|curl\b|wget\b/);
  assert.match(source, /AUTHORIZATION_EXPIRED/);
  assert.match(source, /manual_staging_commands_only/);
});
