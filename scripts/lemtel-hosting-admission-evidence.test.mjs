import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PREREQUISITES, evidencePath, reviewEvidence, run, validateEvidence } from './lemtel-hosting-admission-evidence.mjs';

const base = (state = 'not_provided') => ({
  kind: 'staging_admission_evidence',
  request_id: 'request-32000001',
  evidence_ref: 'evidence-32000001',
  evidence: Object.fromEntries(PREREQUISITES.map((key) => [key, state])),
});

test('incomplete evidence remains non-authorizing and reports only prerequisites', () => {
  const result = reviewEvidence(base());
  assert.equal(result.status, 'evidence_incomplete');
  assert.equal(result.authorization, false);
  assert.deepEqual(result.reasons, [...PREREQUISITES.map((key) => `unmet_${key}`), 'POLICY_REVIEW_REQUIRED']);
});

test('complete evidence is still not deployment authorization', () => {
  const result = reviewEvidence(base('verified'));
  assert.deepEqual(result, {
    status: 'evidence_complete_not_authorization',
    authorization: false,
    reasons: ['POLICY_REVIEW_REQUIRED'],
  });
});

test('invalid shape, opaque IDs and rejected evidence fail closed', () => {
  const invalid = base(); invalid.evidence.unknown = 'verified';
  assert.equal(validateEvidence(invalid), false);
  assert.deepEqual(reviewEvidence(invalid), {
    status: 'evidence_invalid', authorization: false, reasons: ['EVIDENCE_INVALID'],
  });
  const rejected = base('verified'); rejected.evidence.private_dns_and_tls_approved = 'rejected';
  assert.deepEqual(reviewEvidence(rejected), {
    status: 'evidence_incomplete',
    authorization: false,
    reasons: ['evidence_rejected_private_dns_and_tls_approved', 'POLICY_REVIEW_REQUIRED'],
  });
});

test('CLI reads only a constrained evidence path, emits no identifiers and stays blocked', () => {
  const encoded = JSON.stringify(base('verified'));
  const reader = (path) => { assert.match(path, /schemas\/lemtel-staging-admission\/evidence\/sample\.json$/); return encoded; };
  const result = run(['--file=schemas/lemtel-staging-admission/evidence/sample.json'], '/repo', reader);
  assert.equal(result.code, 78);
  assert.doesNotMatch(result.stdout, /request-32000001|evidence-32000001/);
  assert.match(result.stdout, /evidence_complete_not_authorization/);
  assert.equal(evidencePath('--file=../../.env', '/repo'), null);
  assert.equal(evidencePath('--file=schemas/lemtel-staging-admission/evidence/../policy.json', '/repo'), null);
  assert.equal(run(['--file=schemas/lemtel-staging-admission/evidence/missing.json'], '/repo', () => { throw new Error('no'); }).code, 78);
});

test('evidence reviewer has no network, deployment, environment or process-launch capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-hosting-admission-evidence.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|\.listen\s*\(|writeFile|mkdir\s*\(|process\.env|node:(?:net|http|https|tls)|docker|apt(?:-get)?\s+install|curl\b|wget\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
