import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repo, path), 'utf8');
const digest = (path) => createHash('sha256').update(readFileSync(resolve(repo, path))).digest('hex');
const root = 'infra/lemtel-resilience/node-secure-enrollment/';
const functions = 'infra/lemtel-self-hosted/functions/';
const enrollment = read(functions + 'lemtel-node-enrollment/index.ts');
const admin = read(functions + 'lemtel-node-enrollment-admin/index.ts');
const signed = read(functions + 'lemtel-node-status-signed-ingest/index.ts');
const crypto = read(functions + '_shared/lemtelNodeEnrollment.ts');
const backend = read(functions + '_shared/lemtelNodeEnrollmentBackend.ts');
const agent = read(root + 'lemtel-node-publication-agent.ts');
const sql = read('infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql');
for (const source of [enrollment, admin, signed, crypto, backend, agent, sql]) {
  assert.doesNotMatch(source, /pg_promote|systemctl|Deno\.Command|child_process|docker|ssh\b|\/agent\/command|BOOTSTRAP_AUTH_SECRET|AGENT_SHARED_SECRET|LEMTEL_NODE_STATUS_.*SECRET/);
}
for (const source of [enrollment, admin, signed, crypto, backend]) assert.doesNotMatch(source, /console\.|Deno\.env\.toObject/);
assert.match(backend, /approved_publication_only/);
assert.match(enrollment, /signDelivery\(sealed, signer\)/);
assert.match(agent, /openDelivery/); assert.match(agent, /identity\.platformSigningKey/); assert.match(agent, /binding\.endpoint !== config\.endpoint/);
assert.doesNotMatch(agent, /fetch\(|XMLHttpRequest|WebSocket|npm:|--allow-net|source\s+\/etc|eval\(/);
assert.match(agent, /createNew: true, mode: 0o600/); assert.match(agent, /await file\.sync\(\)/); assert.match(agent, /Deno\.uid\(\) !== 0/);
assert.match(agent, /v\.nlink === 1/); assert.match(agent, /status=blocked/);
assert.match(crypto, /AES-GCM/); assert.match(crypto, /HKDF/); assert.match(crypto, /ECDSA/); assert.match(crypto, /ECDH/);
assert.match(crypto, /value\.expiresAt as number\) <= now/); assert.match(crypto, /additionalData: transcript\("seal", challenge\)/);
for (const source of [enrollment, signed]) assert.match(source, /headers\.has\("Origin"\).*Sec-Fetch-Mode/);
assert.match(admin, /d\.actor\(token\)/); assert.match(admin, /lemtel_node_enrollment_is_admin/);
const redactor = admin.slice(admin.indexOf('export function redacted'), admin.indexOf('export function createEnrollmentAdminHandler'));
assert.match(redactor, /return \{ requestId: v\.requestId, role: v\.role, fingerprint: v\.fingerprint, state: v\.state, expiresAt: v\.expiresAt \}/);
assert.doesNotMatch(redactor, /\.nonce|\.descriptor|\.ciphertext|\.endpoint|\.signature/);
assert.match(sql, /CREATE UNIQUE INDEX lemtel_node_one_publication_grant/);
assert.match(sql, /FOR SHARE/); assert.match(sql, /last_sequence < p_sequence/); assert.match(sql, /AND state = 'pending' AND expires_at > v_now/);
assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/);
assert.doesNotMatch(sql.slice(0, sql.indexOf('ALTER TABLE')), /hostname|ip_address|private_key|ciphertext|jsonb|payload|topology/i);
for (const name of ['service', 'timer']) {
  const unit = read(root + 'systemd/lemtel-node-publication-preflight.' + name);
  assert.doesNotMatch(unit, /^\[Install\]/m); assert.match(unit, /ConditionPathExists=.*activation\.approved/);
  if (name === 'service') { assert.match(unit, /PrivateNetwork=true/); assert.match(unit, /agent\.ts check/); assert.doesNotMatch(unit, /--allow-env|--allow-write|--allow-net/); }
}
for (const path of [root + 'deployment-manifest.json', 'infra/lemtel-self-hosted/migrations/lemtel-node-secure-enrollment-manifest.json',
  ...['lemtel-node-enrollment','lemtel-node-enrollment-admin','lemtel-node-status-signed-ingest'].map((slug) => functions + slug + '/manifest.json')]) {
  const m = JSON.parse(read(path)); assert.equal(m.deployment_authorized, false); assert.equal(m.activation_authorized, false);
  for (const e of [...(m.sources ?? []), ...(m.migration_sources ?? []), ...(m.edge_sources ?? []), ...(m.validation_sources ?? []), ...(m.dependencies ?? [])]) assert.equal(digest(e.path), e.sha256, `${path}: ${e.path}`);
}
console.log('node_secure_enrollment_contract=ok');
