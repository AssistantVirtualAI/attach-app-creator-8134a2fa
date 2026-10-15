import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildPackage } from './lemtel-transactional-email-deploy-package.mjs';

const root = resolve(import.meta.dirname, '..');
const remote = readFileSync(resolve(root, 'infra/lemtel-self-hosted/transactional-email-deploy/lemtel-transactional-email-do-writer-deploy.sh'), 'utf8');
const launcher = readFileSync(resolve(root, 'scripts/lemtel-transactional-email-deploy-macos.sh'), 'utf8');
const generator = readFileSync(resolve(root, 'scripts/lemtel-transactional-email-deploy-package.mjs'), 'utf8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const revision = '8be717dd613bedb31467d97a5dfe31c28c1b7d6c';
const manifestPaths = [
  '0019_lemtel_transactional_email_delivery_states.sql',
  'deployment-metadata.json',
  'functions/_shared/lemtelTransactionalEmail.ts',
  'functions/lemtel-onboarding-admin/index.ts',
  'functions/lemtel-onboarding-admin/manifest.json',
  'functions/lemtel-password-reset-request/index.ts',
  'functions/lemtel-password-reset-request/manifest.json',
  'functions/lemtel-resend-delivery-webhook/index.ts',
  'functions/lemtel-resend-delivery-webhook/manifest.json',
  'lemtel-transactional-email-do-writer-deploy.sh',
  'portal.tar',
];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-transactional-email-package-'));
  const portal = join(directory, 'portal');
  mkdirSync(join(portal, 'assets'), { recursive: true });
  writeFileSync(join(portal, 'lemtel-portal.html'), '<!doctype html><title>Lemtel</title>\n');
  writeFileSync(join(portal, 'assets', 'entry.js'), 'console.log("lemtel");\n');
  return { directory, portal };
}

function tarList(archive) {
  return execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
}

test('generator produces byte-identical sealed archives for identical reviewed portal inputs', () => {
  const { directory, portal } = fixture();
  try {
    const first = join(directory, 'first.tar');
    const second = join(directory, 'second.tar');
    const firstResult = buildPackage({ portalDir: portal, output: first, sourceRevision: revision });
    const secondResult = buildPackage({ portalDir: portal, output: second, sourceRevision: revision });
    assert.equal(firstResult.archiveSha256, secondResult.archiveSha256);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.equal(firstResult.packageFileCount, manifestPaths.length + 1);
    assert.equal(firstResult.portalFileCount, 2);
    assert.deepEqual(tarList(first), [...manifestPaths, 'manifest.sha256'].sort());
    assert.match(readFileSync(`${first}.sha256`, 'utf8'), new RegExp(`^${firstResult.archiveSha256}  first\\.tar\\n$`));
    assert.match(readFileSync(`${second}.sha256`, 'utf8'), new RegExp(`^${secondResult.archiveSha256}  second\\.tar\\n$`));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('internal manifest covers exactly the allowlist and portal tar excludes non-Lemtel repository assets', () => {
  const { directory, portal } = fixture();
  try {
    const archive = join(directory, 'package.tar');
    const extracted = join(directory, 'extracted');
    buildPackage({ portalDir: portal, output: archive, sourceRevision: revision });
    mkdirSync(extracted);
    execFileSync('tar', ['-xf', archive, '-C', extracted]);
    const manifest = readFileSync(join(extracted, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.deepEqual(manifest.map((line) => line.slice(66)), manifestPaths);
    for (const line of manifest) {
      const [digest, file] = line.split('  ');
      assert.match(digest, /^[a-f0-9]{64}$/u);
      assert.equal(hash(readFileSync(join(extracted, file))), digest, file);
    }
    assert.deepEqual(tarList(join(extracted, 'portal.tar')), ['assets/entry.js', 'lemtel-portal.html']);
    assert.equal(existsSync(join(extracted, 'src')), false);
    assert.doesNotMatch(readFileSync(join(extracted, 'deployment-metadata.json'), 'utf8'), /RESEND_API_KEY|RESEND_WEBHOOK_SECRET|re_[A-Za-z0-9_-]{16,}/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generator rejects missing required portal files and invalid source revisions before writing a package', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-transactional-email-invalid-'));
  try {
    const portal = join(directory, 'portal');
    mkdirSync(portal);
    assert.throws(() => buildPackage({ portalDir: portal, output: join(directory, 'bad.tar'), sourceRevision: revision }), /portal_entry_missing/);
    assert.throws(() => buildPackage({ portalDir: portal, output: join(directory, 'bad.tar'), sourceRevision: 'not-a-revision' }), /source_revision_invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote deployer is root-gated, exact-writer-only, attested, sealed, and rollback-aware', () => {
  for (const expected of [
    '[ "$(id -u)" -eq 0 ]',
    'LEMTEL_TRANSACTIONAL_EMAIL_EXECUTE:-',
    'deploy_reviewed_transactional_email',
    'LEMTEL_HA_ROLE:-',
    'digitalocean_writer',
    'LEMTEL_TRANSACTIONAL_EMAIL_SNAPSHOT_ATTESTATION:-',
    'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED',
    'sha256sum --strict --status -c',
    'manifest_allowlist_invalid',
    'SELECT pg_is_in_recovery()::text',
    'flock -n 9',
    '0019_lemtel_transactional_email_delivery_states.sql',
    'deno check --cached-only --quiet',
    'rollback_files()',
    'database_recovery=operator_snapshot_required',
  ]) assert.match(remote, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(remote, /environment_names_checked=true/);
  assert.match(remote, /environment_configuration_valid=%s/);
  assert.match(remote, /resend_secret_tty_injection=unsupported_by_documented_edge_runtime/);
});

test('remote deployer never transmits, logs, creates, or prompts for a secret and never activates external scope', () => {
  for (const forbidden of [
    /read\s+-[A-Za-z]*s/i,
    /RESEND_API_KEY\s*=/,
    /RESEND_WEBHOOK_SECRET\s*=/,
    /(?:curl|wget|ssh|scp|rsync|doctl|hcloud)\b/i,
    /cloudflare\.com|api\/v4\/zones/i,
    /(?:pg_promote|docker\s+(?:run|compose\s+up))/i,
    /(?:hostinger).*(?:start|promote|power|rebuild)/i,
  ]) assert.doesNotMatch(remote, forbidden);
  for (const expected of [
    'email_sent=false', 'password_reset_triggered=false', 'welcome_triggered=false',
    'resend_webhook_registered=false', 'resend_webhook_enabled=false',
    'hostinger_touched=false', 'dns_change_executed=false', 'telephony_touched=false',
  ]) assert.match(remote, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('macOS launcher is short, has no inline host URL or secret, and requires a target plus review gates', () => {
  assert.ok(launcher.trim().split('\n').length <= 24);
  for (const expected of ['[ "$#" -eq 2 ]', 'REVIEWED_WRITER_DEPLOYMENT', 'FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED', 'ssh -tt "$target"']) {
    assert.match(launcher, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(launcher, /https?:\/\/|\b(?:resend|api[_-]?key|webhook[_-]?secret)\b|@/iu);
});

test('package generation remains local-only while shell entrypoints parse without execution', () => {
  assert.doesNotMatch(generator, /process\.env|\b(?:fetch|http|https|ssh|scp|docker|curl|wget|child_process)\b/iu);
  execFileSync('bash', ['-n', resolve(root, 'scripts/lemtel-transactional-email-deploy-macos.sh')]);
  execFileSync('bash', ['-n', resolve(root, 'infra/lemtel-self-hosted/transactional-email-deploy/lemtel-transactional-email-do-writer-deploy.sh')]);
});
