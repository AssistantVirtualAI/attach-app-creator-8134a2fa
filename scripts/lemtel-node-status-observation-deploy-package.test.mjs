import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PACKAGE_FILES, assemblePackage, deterministicTar, normalizedPath, parseArgs } from './lemtel-node-status-observation-deploy-package.mjs';

const root = resolve(import.meta.dirname, '..');
const revision = '7daec6cde62326846805f99071cd90ce5e6b5efa';
const generator = readFileSync(resolve(root, 'scripts/lemtel-node-status-observation-deploy-package.mjs'), 'utf8');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const listTar = (archive) => execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();

function extract(archive, destination) {
  mkdirSync(destination);
  execFileSync('tar', ['-xf', archive, '-C', destination]);
}

test('sealed node-status package is reproducible, fully digested and restricted to deployer inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-node-status-package-'));
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
    extract(first, unpacked);
    const manifestLines = readFileSync(join(unpacked, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.deepEqual(manifestLines.map((line) => line.slice(66)), [...PACKAGE_FILES].sort());
    for (const line of manifestLines) {
      const [fileDigest, file] = line.split('  ');
      assert.match(fileDigest, /^[a-f0-9]{64}$/u);
      assert.equal(digest(readFileSync(join(unpacked, file))), fileDigest, file);
    }

    const metadata = JSON.parse(readFileSync(join(unpacked, 'deployment-metadata.json'), 'utf8'));
    assert.equal(metadata.source_revision, revision);
    assert.equal(metadata.target_role, 'digitalocean_writer');
    assert.equal(metadata.schema_apply_idempotent, true);
    assert.equal(metadata.edge_runtime_restart_required, true);
    for (const key of ['secrets_in_bundle', 'publisher_configuration_written', 'publisher_installed', 'publisher_timer_enabled', 'standby_runtime_started', 'caddy_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read', 'deployment_authorized', 'activation_authorized']) assert.equal(metadata[key], false, key);

    const sourceManifest = JSON.parse(readFileSync(join(unpacked, 'lemtel-node-status-manifest.json'), 'utf8'));
    const expected = new Map([...sourceManifest.migration_sources, ...sourceManifest.edge_sources].map((entry) => [entry.path, entry.sha256]));
    assert.equal(digest(readFileSync(join(unpacked, '0020_lemtel_node_status_observations.sql'))), expected.get('infra/lemtel-self-hosted/migrations/0020_lemtel_node_status_observations.sql'));
    assert.equal(digest(readFileSync(join(unpacked, 'lemtel-node-status-ingest.index.ts'))), expected.get('infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/index.ts'));
    assert.equal(digest(readFileSync(join(unpacked, 'lemtel-node-status-ingest.manifest.json'))), expected.get('infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/manifest.json'));
    assert.equal(digest(readFileSync(join(unpacked, 'lemtel-onboarding-admin.index.ts'))), expected.get('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'));
    assert.equal(digest(readFileSync(join(unpacked, 'lemtel-onboarding-admin.manifest.json'))), expected.get('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generator rejects unsafe paths, malformed arguments, preexisting outputs and source-manifest drift', () => {
  assert.throws(() => normalizedPath('../outside'), /unsafe_path/);
  assert.throws(() => normalizedPath('/absolute'), /unsafe_path/);
  assert.throws(() => normalizedPath('one\\two'), /unsafe_path/);
  assert.throws(() => deterministicTar([{ path: 'same', bytes: Buffer.from('a') }, { path: 'same', bytes: Buffer.from('b') }]), /duplicate_archive_path/);
  assert.throws(() => parseArgs([]), /usage_invalid/);
  assert.throws(() => parseArgs(['--source-revision', 'nope', '--output', 'out.tar']), /source_revision_invalid/);

  const directory = mkdtempSync(join(tmpdir(), 'lemtel-node-status-package-reject-'));
  try {
    const output = join(directory, 'already.tar');
    readFileSync(resolve(root, 'AGENTS.md'));
    execFileSync('touch', [output]);
    assert.throws(() => assemblePackage({ output, sourceRevision: revision }), /output_already_exists/);
    rmSync(output);
    assert.throws(() => assemblePackage({
      output,
      sourceRevision: revision,
      sourceReader: (sourceRevision, source) => {
        const bytes = execFileSync('git', ['-C', root, 'show', `${sourceRevision}:${source}`]);
        return source.endsWith('lemtel-node-status-ingest/index.ts') ? Buffer.concat([bytes, Buffer.from('// drift\n')]) : bytes;
      },
    }), /node_status_source_manifest_mismatch/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('offline generator has no publisher, deployer, runtime, provider, network or secret operation', () => {
  assert.deepEqual([...PACKAGE_FILES].sort(), [
   '0020_lemtel_node_status_observations.sql', 'deployment-metadata.json',
   'lemtel-node-status-ingest.index.ts', 'lemtel-node-status-ingest.manifest.json', 'lemtel-node-status-manifest.json',
   'lemtel-onboarding-admin.index.ts', 'lemtel-onboarding-admin.manifest.json',
  ].sort());
  for (const excluded of ['lemtel-node-status-publish.sh', 'lemtel-node-status-publisher.service', 'lemtel-node-status-publisher.timer', '.env', 'Caddyfile', 'docker-compose.yml']) assert.ok(!PACKAGE_FILES.includes(excluded), excluded);
  assert.doesNotMatch(generator, /execFileSync\('\s*(?:curl|wget|ssh|scp|rsync|systemctl|docker|doctl|hcloud|nsupdate)/iu);
  assert.doesNotMatch(generator, /\bfetch\s*\(/u);
  assert.doesNotMatch(generator, /LEMTEL_NODE_STATUS_[A-Z_]*SECRET|PRIVATE KEY|BEGIN [A-Z ]+KEY/iu);
  assert.match(generator, /sourceAtRevision/);
  assert.match(generator, /deterministicTar/);
});
