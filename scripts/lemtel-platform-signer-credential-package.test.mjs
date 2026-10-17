import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { PACKAGE_FILES, assemble, parseArgs, tar } from './lemtel-platform-signer-credential-package.mjs';

const root = resolve(import.meta.dirname, '..');
const shellPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.sh');
const pythonPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.py');
const docPath = resolve(root, 'docs/lemtel-ha/PLATFORM_SIGNER_CREDENTIAL.md');
const shell = readFileSync(shellPath, 'utf8');
const python = readFileSync(pythonPath, 'utf8');
const documentation = readFileSync(docPath, 'utf8');

async function assertP256(privateJwk, publicKey) {
  const raw = Buffer.from(publicKey, 'base64url');
  assert.equal(raw.byteLength, 65);
  const privateKey = await webcrypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicCryptoKey = await webcrypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const message = Buffer.from('lemtel-platform-signer-credential-test');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicCryptoKey, signature, message), true);
}

test('package includes only offline credential initialization sources', () => {
  assert.deepEqual(PACKAGE_FILES, [
    'deployment-metadata.json',
    'docs/lemtel-ha/PLATFORM_SIGNER_CREDENTIAL.md',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.py',
    'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.sh',
    'manifest.sha256',
  ]);
});

test('root-only initializer is syntactically valid and requires all explicit gates', () => {
  assert.equal(execFileSync('bash', ['-n', shellPath], { encoding: 'utf8' }), '');
  for (const expected of ['root_required', 'execution_token_required', 'writer_role_required', 'fresh_snapshot_attestation_required', 'initialize_encrypted_platform_signer', 'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED', 'systemd_creds_version_unsupported', 'encrypted_credential_exists_requires_rotation', 'public_pin_directory_exists_requires_rotation']) assert.match(shell, new RegExp(expected));
  assert.match(shell, /systemd-creds/);
  assert.match(shell, /encrypt --name="\$credential_name" - "\$credential_tmp"/);
  assert.match(shell, /env -i/);
  assert.match(shell, /chmod 0600/);
  assert.match(shell, /credential_values_emitted=false/);
});

test('credential initializer excludes runtime activation, secret transport and infrastructure mutation', () => {
  for (const expected of ['edge_runtime_changed=false', 'enrollment_enabled=false', 'node_binding_written=false', 'publisher_configuration_written=false', 'service_installed=false', 'cloudflare_or_dns_changed=false', 'promotion_executed=false', 'fencing_executed=false', 'automatic_failover_enabled=false', 'telephony_contacted=false']) assert.ok(shell.includes(expected), expected);
  assert.doesNotMatch(shell, /(?:^|[;&|\s])(?:curl|wget|ssh|scp|rsync|docker|systemctl|doctl|hcloud|pg_promote)\b/imu);
  assert.doesNotMatch(shell, /(?:Authorization: Bearer|BEGIN [A-Z ]*PRIVATE KEY|LEMTEL_[A-Z0-9_]*(?:TOKEN|SECRET|PRIVATE_KEY))/u);
  assert.doesNotMatch(python, /(?:urllib|requests|socket|http\.client|os\.system|shell=True|curl|wget|ssh\b|docker|systemctl)/u);
  assert.match(python, /\['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-outform', 'DER'\]/);
});

test('Python material generation produces an ECDSA-compatible private JWK and public pin', async () => {
  const code = "import importlib.util,json,sys; sys.dont_write_bytecode=True; s=importlib.util.spec_from_file_location('k',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); a,b=m.create_material(); print(json.dumps({'private':a,'public':b}))";
  const value = JSON.parse(execFileSync('python3', ['-I', '-c', code, pythonPath], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(value.public).sort(), ['fingerprint', 'format', 'platformSigningKey']);
  assert.equal(value.public.format, 'lemtel-platform-signing-public-v1');
  assert.match(value.public.fingerprint, /^sha256:[a-f0-9]{64}$/);
  await assertP256(value.private, value.public.platformSigningKey);
});

test('archive is deterministic and does not create a credential', () => {
  const first = tar([{ path: 'b', bytes: 'two' }, { path: 'a', bytes: 'one' }]);
  const second = tar([{ path: 'a', bytes: 'one' }, { path: 'b', bytes: 'two' }]);
  assert.deepEqual(first, second);
  const sandbox = mkdtempSync(resolve(tmpdir(), 'lemtel-signer-package-'));
  try {
    const output = resolve(sandbox, 'package.tar');
    const source = (revision, path) => Buffer.from(`${revision}:${path}`);
    const result = assemble({ sourceRevision: 'a'.repeat(40), output, sourceReader: source });
    assert.equal(result.packageFileCount, PACKAGE_FILES.length);
    assert.ok(readFileSync(output).byteLength > 1024);
    assert.match(readFileSync(`${output}.sha256`, 'utf8'), /^[a-f0-9]{64}  package\.tar\n$/);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test('command parsing rejects ambiguous credential package targets', () => {
  assert.deepEqual(parseArgs(['--source-revision', 'a'.repeat(40), '--output', '/tmp/package.tar']), { sourceRevision: 'a'.repeat(40), output: '/tmp/package.tar' });
  assert.throws(() => parseArgs([]), /usage_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'bad', '--output', '/tmp/package.tar']), /source_revision_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'a'.repeat(40), '--output', 'relative.tar']), /output_path_invalid/);
});

test('documentation records encrypted-at-rest limitation and non-activation boundary', () => {
  for (const expected of ['`systemd-creds encrypt`', 'LoadCredentialEncrypted=', 'systemd **250 ou plus**', 'ne crée pas de service systemd', 'restent `503`', 'canal indépendant authentifié']) assert.ok(documentation.includes(expected), expected);
  assert.equal(createHash('sha256').update(readFileSync(shellPath)).digest('hex').length, 64);
});
