import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PACKAGE_FILES, assemblePackage, checkedOutRevision, deterministicTar, normalizedPath, parseArgs, sourceAtRevision } from './lemtel-node-secure-enrollment-deploy-package.mjs';

const root = resolve(import.meta.dirname, '..');
// Seal only the detached revision under test: a historical SHA cannot represent
// a later reviewed manifest chain.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const generatorPath = resolve(root, 'scripts/lemtel-node-secure-enrollment-deploy-package.mjs');
const generator = readFileSync(generatorPath, 'utf8');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const listTar = (archive) => execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();

function unpack(archive, destination) {
  execFileSync('mkdir', ['-p', destination]);
  execFileSync('tar', ['-xf', archive, '-C', destination]);
}

test('signed enrollment package is reproducible, exactly allowlisted and manifest.sha256 is explicitly accepted', () => {
  assert.equal(checkedOutRevision(), revision, 'test must run from the required detached integration SHA');
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-node-enrollment-package-'));
  try {
    const first = join(directory, 'first.tar');
    const second = join(directory, 'second.tar');
    const firstResult = assemblePackage({ output: first, sourceRevision: revision });
    const secondResult = assemblePackage({ output: second, sourceRevision: revision });
    assert.equal(firstResult.archiveSha256, secondResult.archiveSha256);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.equal(firstResult.packageFileCount, PACKAGE_FILES.length + 1);
    assert.deepEqual(listTar(first), [...PACKAGE_FILES, 'manifest.sha256'].sort());
    assert.match(readFileSync(`${first}.sha256`, 'utf8'), new RegExp(`^${firstResult.archiveSha256}  first\\.tar\\n$`));

    const unpacked = join(directory, 'unpacked');
    unpack(first, unpacked);
    const manifestLines = readFileSync(join(unpacked, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.equal(manifestLines.length, PACKAGE_FILES.length);
    assert.deepEqual(manifestLines.map((line) => line.slice(66)), [...PACKAGE_FILES].sort());
    assert.ok(!manifestLines.some((line) => line.endsWith('manifest.sha256')), 'the manifest is accepted as an archive member but never self-hashes');
    for (const line of manifestLines) {
      const [fileDigest, file] = line.split('  ');
      assert.match(fileDigest, /^[a-f0-9]{64}$/u);
      assert.equal(digest(readFileSync(join(unpacked, file))), fileDigest, file);
    }

    const metadata = JSON.parse(readFileSync(join(unpacked, 'deployment-metadata.json'), 'utf8'));
    assert.equal(metadata.source_revision, revision);
    assert.equal(metadata.target_role, 'digitalocean_writer');
    assert.equal(metadata.node_status_schema_prerequisite, '0020_lemtel_node_status_observations.sql');
    assert.equal(metadata.node_status_schema_apply, false);
    assert.equal(metadata.schema_migration, '0021_lemtel_node_secure_enrollment.sql');
    for (const key of ['secrets_in_bundle', 'secret_configuration_written', 'publisher_configuration_written', 'publisher_installed', 'publisher_timer_enabled', 'agent_installed', 'agent_activated', 'service_activated', 'timer_activated', 'standby_runtime_started', 'caddy_changed', 'routes_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read', 'deployment_authorized', 'activation_authorized']) assert.equal(metadata[key], false, key);

    const sourceManifest = JSON.parse(readFileSync(join(unpacked, 'lemtel-node-secure-enrollment-manifest.json'), 'utf8'));
    const expected = new Map([...sourceManifest.migration_sources, ...sourceManifest.edge_sources, ...sourceManifest.dependencies].map((entry) => [entry.path, entry.sha256]));
    const sourceToBundle = new Map([
      ['infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql', '0021_lemtel_node_secure_enrollment.sql'],
      ['infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts', 'lemtelNodeEnrollment.ts'],
      ['infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollmentBackend.ts', 'lemtelNodeEnrollmentBackend.ts'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.ts', 'lemtel-node-enrollment.index.ts'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-enrollment/manifest.json', 'lemtel-node-enrollment.manifest.json'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/index.ts', 'lemtel-node-enrollment-admin.index.ts'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/manifest.json', 'lemtel-node-enrollment-admin.manifest.json'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/index.ts', 'lemtel-node-status-signed-ingest.index.ts'],
      ['infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/manifest.json', 'lemtel-node-status-signed-ingest.manifest.json'],
      ['infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts', 'lemtel-onboarding-admin.index.ts'],
    ]);
    for (const [source, bundled] of sourceToBundle) assert.equal(digest(readFileSync(join(unpacked, bundled))), expected.get(source), source);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generator rejects unsafe values, wrong detached SHA, existing outputs and source-manifest drift', () => {
  assert.throws(() => normalizedPath('../outside'), /unsafe_path/);
  assert.throws(() => normalizedPath('/absolute'), /unsafe_path/);
  assert.throws(() => normalizedPath('one\\two'), /unsafe_path/);
  assert.throws(() => deterministicTar([{ path: 'same', bytes: Buffer.from('a') }, { path: 'same', bytes: Buffer.from('b') }]), /duplicate_archive_path/);
  assert.throws(() => parseArgs([]), /usage_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'nope', '--output', '/tmp/out.tar']), /source_revision_invalid/);
  assert.throws(() => parseArgs(['--source-revision', revision, '--output', 'relative.tar']), /output_path_invalid/);
  assert.throws(() => sourceAtRevision('a'.repeat(40), 'infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql'), /source_revision_not_checked_out/);

  const directory = mkdtempSync(join(tmpdir(), 'lemtel-node-enrollment-package-reject-'));
  try {
    const output = join(directory, 'already.tar');
    execFileSync('touch', [output]);
    assert.throws(() => assemblePackage({ output, sourceRevision: revision }), /output_already_exists/);
    rmSync(output);
    assert.throws(() => assemblePackage({
      output,
      sourceRevision: revision,
      sourceReader: (sourceRevision, source) => {
        const bytes = sourceAtRevision(sourceRevision, source);
        return source.endsWith('lemtel-node-enrollment/index.ts') ? Buffer.concat([bytes, Buffer.from('// drift\n')]) : bytes;
      },
    }), /enrollment_source_manifest_mismatch/);
    assert.equal(existsSync(output), false);
    assert.throws(() => assemblePackage({
      output,
      sourceRevision: revision,
      sourceReader: (sourceRevision, source) => {
        const bytes = sourceAtRevision(sourceRevision, source);
        return source.endsWith('deployment-manifest.json') ? Buffer.concat([bytes, Buffer.from(' \n')]) : bytes;
      },
    }), /enrollment_manifest_digest_mismatch/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('offline generator includes no secret, activation, route or remote/deployment operation', () => {
  assert.deepEqual([...PACKAGE_FILES].sort(), [
    '0021_lemtel_node_secure_enrollment.sql', 'deployment-metadata.json',
    'lemtel-node-enrollment-admin.index.ts', 'lemtel-node-enrollment-admin.manifest.json',
    'lemtel-node-enrollment.index.ts', 'lemtel-node-enrollment.manifest.json',
    'lemtel-node-secure-enrollment-manifest.json',
    'lemtel-node-status-signed-ingest.index.ts', 'lemtel-node-status-signed-ingest.manifest.json',
    'lemtel-onboarding-admin.index.ts', 'lemtel-onboarding-admin.manifest.json',
    'lemtelNodeEnrollment.ts', 'lemtelNodeEnrollmentBackend.ts',
  ].sort());
  for (const excluded of ['.env', 'Caddyfile', 'docker-compose.yml', 'lemtel-node-publication-agent.ts', 'lemtel-node-publication-preflight.service', 'lemtel-node-publication-preflight.timer', 'route-config.json']) assert.ok(!PACKAGE_FILES.includes(excluded), excluded);
  assert.doesNotMatch(generator, /node:child_process|execFileSync|spawnSync|\bfetch\s*\(|\b(?:curl|wget|ssh|scp|rsync|docker|systemctl|doctl|hcloud|nsupdate)\b/iu);
  assert.doesNotMatch(generator, /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|LEMTEL_[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY)\s*=/iu);
  assert.match(generator, /checkedOutRevision/);
  assert.match(generator, /deterministicTar/);
});
