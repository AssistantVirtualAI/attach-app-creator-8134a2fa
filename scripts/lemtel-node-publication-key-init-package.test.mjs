import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PACKAGE_FILES, deterministicTar, parseArgs } from './lemtel-node-publication-key-init-package.mjs';
import { canonical, fingerprint, generateNodeKeys } from '../infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh');
const agentPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts');
const nodePath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs');
const manifestPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/deployment-manifest.json');
const script = readFileSync(scriptPath, 'utf8');
const agent = readFileSync(agentPath, 'utf8');
const node = readFileSync(nodePath, 'utf8');
const digest = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');

test('key-init package admits exactly the local agents, shared crypto and local gate script', () => {
  assert.deepEqual(PACKAGE_FILES, [
    'deployment-metadata.json',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh',
    'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts',
  ]);
  for (const excluded of ['.env', 'docker-compose.yml', 'Caddyfile', 'lemtel-node-status-publish.sh', 'lemtel-ha-hostinger-failover-agent.sh']) assert.ok(!PACKAGE_FILES.includes(excluded), excluded);
});

test('key-init deployer gates root, explicit local execution and a secure local runtime', () => {
  assert.equal(execFileSync('bash', ['-n', scriptPath], { encoding: 'utf8' }), '');
  for (const expected of ['root_required', 'execution_token_required', 'node_role_required', 'generate_publication_keys_only', 'do_writer|hostinger_standby', 'local_state_exists_requires_review', 'secure_runtime_missing', 'deno_version_unsupported', 'node_version_unsupported']) assert.match(script, new RegExp(expected));
  assert.match(script, /--deny-net/);
  assert.match(script, /--allow-env=LEMTEL_NODE_LOCAL_APPROVAL/);
  assert.match(script, /--allow-sys=uid/);
  assert.match(agent, /createNew: true/);
  assert.match(agent, /LEMTEL_NODE_LOCAL_APPROVAL/);
  assert.match(node, /LEMTEL_NODE_LOCAL_APPROVAL/);
});

test('Node WebCrypto fallback produces compatible independent P-256 key pairs', async () => {
  const keys = await generateNodeKeys();
  assert.deepEqual(Object.keys(keys.descriptor).sort(), ['encryptionKey', 'signingKey']);
  assert.match(fingerprint(keys.descriptor), /^sha256:[a-f0-9]{64}$/);
  assert.match(canonical(keys), /^\{"descriptor":/);
  for (const key of [keys.signingPrivate, keys.encryptionPrivate]) assert.equal(typeof key.d, 'string');
  const signingPublic = await webcrypto.subtle.importKey('raw', Buffer.from(keys.descriptor.signingKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signingPrivate = await webcrypto.subtle.importKey('jwk', keys.signingPrivate, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const message = Buffer.from('lemtel-node-key-init-test', 'utf8');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingPrivate, message);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signingPublic, signature, message), true);
  const encryptionPublic = await webcrypto.subtle.importKey('raw', Buffer.from(keys.descriptor.encryptionKey, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const encryptionPrivate = await webcrypto.subtle.importKey('jwk', keys.encryptionPrivate, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  assert.equal((await webcrypto.subtle.deriveBits({ name: 'ECDH', public: encryptionPublic }, encryptionPrivate, 256)).byteLength, 32);
});

test('key-init deployer only emits a public fingerprint and explicit non-activation outcomes', () => {
  for (const expected of ['public_fingerprint=', 'network_access=false', 'secrets_configured=false', 'publication_configured=false', 'publication_executed=false', 'service_installed=false', 'timer_enabled=false', 'provider_contacted=false', 'cloudflare_or_dns_changed=false', 'promotion_executed=false', 'fencing_executed=false', 'automatic_failover_enabled=false', 'telephony_contacted=false']) assert.ok(script.includes(expected), expected);
  assert.doesNotMatch(script, /(?:^|[;&|\s])(?:curl|wget|ssh|scp|rsync|systemctl|docker|pg_promote)\b/imu);
  assert.doesNotMatch(script, /(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD)/u);
  assert.doesNotMatch(node, /(?:fetch\(|XMLHttpRequest|WebSocket|child_process|Deno\.Command|docker|ssh\b|systemctl|pg_promote)/u);
});

test('key-init deployer refuses unsafe archive structure and root state reuse', () => {
  for (const expected of ['archive_security_invalid', 'archive_digest_mismatch', 'archive_layout_invalid', 'archive_member_type_invalid', 'bundle_file_missing', 'package_metadata_invalid', 'key_file_security_invalid']) assert.ok(script.includes(expected), expected);
  assert.match(script, /\[ ! -e "\$config" \] && \[ ! -e "\$state" \] \|\| fail local_state_exists_requires_review/);
  assert.match(script, /chmod 0700/);
  assert.match(agent, /mode: 0o600/);
  assert.match(node, /openSync\(path, 'wx', 0o600\)/);
});

test('deterministic archive uses stable regular files only', () => {
  const first = deterministicTar([{ path: 'b', bytes: Buffer.from('two') }, { path: 'a', bytes: Buffer.from('one') }]);
  const second = deterministicTar([{ path: 'a', bytes: Buffer.from('one') }, { path: 'b', bytes: Buffer.from('two') }]);
  assert.deepEqual(first, second);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'lemtel-key-init-tar-'));
  try {
    const archive = resolve(sandbox, 'package.tar');
    writeFileSync(archive, first);
    assert.deepEqual(execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n'), ['a', 'b']);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test('package command-line parsing rejects ambiguous values', () => {
  assert.deepEqual(parseArgs(['--source-revision', 'a'.repeat(40), '--output', '/tmp/package.tar']), { sourceRevision: 'a'.repeat(40), output: '/tmp/package.tar' });
  assert.throws(() => parseArgs([]), /usage_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'bad', '--output', '/tmp/package.tar']), /source_revision_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'a'.repeat(40), '--source-revision', 'a'.repeat(40)]), /usage_invalid/);
});

test('enrollment manifest binds the local package sources and preserves source-only authorization', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.deployment_authorized, false);
  assert.equal(manifest.activation_authorized, false);
  assert.equal(manifest.runtime_key_generation_authorized, false);
  const sources = new Map(manifest.sources.map((entry) => [entry.path, entry.sha256]));
  const validation = new Map(manifest.validation_sources.map((entry) => [entry.path, entry.sha256]));
  for (const path of ['infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs', 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh']) assert.equal(sources.get(path), digest(path));
  for (const path of ['scripts/lemtel-node-publication-key-init-package.mjs', 'scripts/lemtel-node-publication-key-init-package.test.mjs']) assert.equal(validation.get(path), digest(path));
});
