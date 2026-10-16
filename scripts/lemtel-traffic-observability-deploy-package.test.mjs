import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PACKAGE_FILES, artifactDigest, assemblePackage, selectGithubArtifact, validateGithubRun } from './lemtel-traffic-observability-deploy-package.mjs';

const root = resolve(import.meta.dirname, '..');
const generator = readFileSync(resolve(root, 'scripts/lemtel-traffic-observability-deploy-package.mjs'), 'utf8');
const revision = 'ce156b4391cc92f8e052c61dc1fd7df608cb2a71';
const portalDigest = 'a'.repeat(64);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const portalEntries = [
  { path: 'lemtel-portal.html', bytes: Buffer.from('<!doctype html><title>Lemtel</title>\n') },
  { path: 'assets/portal-123.css', bytes: Buffer.from('body{color:#111}\n') },
  { path: 'assets/portal-123.js', bytes: Buffer.from('console.info("Lemtel portal");\n') },
];

const provenance = {
  github_repository: 'AssistantVirtualAI/attach-app-creator-8134a2fa',
  github_workflow: '.github/workflows/lemtel-operations-portal-build.yml',
  github_run_id: 12345,
  github_run_head_sha: revision,
  github_artifact_id: 98765,
  github_artifact_name: 'lemtel-operations-portal-12345',
  github_artifact_sha256: portalDigest,
};

const sourceReader = (_sourceRevision, source) => Buffer.from(`// reviewed Lemtel-only source: ${source}\n`, 'utf8');

function tarList(archive) {
  return execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
}

function extract(archive, directory) {
  mkdirSync(directory);
  execFileSync('tar', ['-xf', archive, '-C', directory]);
}

test('sealed package is byte-reproducible, SHA-256 covered, and contains exactly the existing deployer inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-traffic-package-'));
  try {
    const first = join(directory, 'first.tar');
    const second = join(directory, 'second.tar');
    const firstResult = assemblePackage({ output: first, sourceRevision: revision, provenance, portalEntries });
    const secondResult = assemblePackage({ output: second, sourceRevision: revision, provenance, portalEntries });
    assert.equal(firstResult.archiveSha256, secondResult.archiveSha256);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.equal(firstResult.packageFileCount, PACKAGE_FILES.length + 1);
    assert.equal(firstResult.portalFileCount, portalEntries.length);
    assert.deepEqual(tarList(first), [...PACKAGE_FILES, 'manifest.sha256'].sort());
    assert.match(readFileSync(`${first}.sha256`, 'utf8'), new RegExp(`^${firstResult.archiveSha256}  first\\.tar\\n$`));

    const unpacked = join(directory, 'unpacked');
    extract(first, unpacked);
    const manifest = readFileSync(join(unpacked, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.deepEqual(manifest.map((line) => line.slice(66)), [...PACKAGE_FILES].sort());
    for (const line of manifest) {
      const [digest, file] = line.split('  ');
      assert.match(digest, /^[a-f0-9]{64}$/u);
      assert.equal(hash(readFileSync(join(unpacked, file))), digest, file);
    }
    assert.deepEqual(tarList(join(unpacked, 'portal.tar')), portalEntries.map((entry) => entry.path).sort());

    const metadata = JSON.parse(readFileSync(join(unpacked, 'deployment-metadata.json'), 'utf8'));
    assert.equal(metadata.scope, 'lemtel_traffic_observability');
    assert.deepEqual(metadata.github_actions_portal_artifact, provenance);
    for (const key of [
      'secrets_in_bundle', 'personal_data_in_bundle', 'ip_addresses_in_bundle', 'traffic_content_in_bundle',
      'collector_activation', 'collector_timer_enabled', 'gateway_route_changed', 'global_jwt_bypass',
      'automatic_failover_enabled', 'hostinger_contacted', 'cloudflare_contacted', 'telephony_contacted',
      'failover_contacted', 'deployment_authorized', 'activation_authorized',
    ]) assert.equal(metadata[key], false, `${key} must remain false`);
    const serialised = readFileSync(first, 'utf8');
    assert.doesNotMatch(serialised, /LEMTEL_TRAFFIC_COLLECTOR_SECRET=|BEGIN (?:RSA |EC )?PRIVATE KEY|192\.0\.2\.1|pcap/iu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the package cannot accept collector, timer, Caddy route, secrets, PII, IP, or traffic-content files', () => {
  assert.deepEqual([...PACKAGE_FILES].sort(), [
    '0017_lemtel_traffic_samples.sql', 'deployment-metadata.json',
    'lemtel-onboarding-admin.index.ts', 'lemtel-onboarding-admin.manifest.json',
    'lemtel-traffic-ingest.index.ts', 'lemtel-traffic-ingest.manifest.json', 'portal.tar',
  ].sort());
  for (const forbiddenName of ['lemtel-traffic-collect.sh', 'lemtel-traffic-timer-enable.sh', 'lemtel-ha-do-writer-traffic-ingress-route-apply.sh', 'Caddyfile', '.env', 'traffic.json', 'capture.pcap']) {
    assert.ok(!PACKAGE_FILES.includes(forbiddenName), `bundle allowlist must exclude ${forbiddenName}`);
  }

  const directory = mkdtempSync(join(tmpdir(), 'lemtel-traffic-package-invalid-'));
  try {
    assert.throws(
      () => assemblePackage({
        output: join(directory, 'bad.tar'), sourceRevision: revision, provenance,
        portalEntries: [...portalEntries, { path: 'traffic.json', bytes: Buffer.from('{"client_ip":"192.0.2.1"}') }], sourceReader,
      }),
      /portal_artifact_files_invalid/,
    );
    assert.throws(
      () => assemblePackage({ output: join(directory, 'bad.tar'), sourceRevision: revision, provenance, portalEntries: [{ path: 'lemtel-portal.html', bytes: Buffer.from('x') }], sourceReader }),
      /portal_artifact_files_invalid/,
    );
    assert.equal(existsSync(join(directory, 'bad.tar')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('GitHub Actions provenance is exact, successful, non-expired and SHA-256-attested before a portal is read', () => {
  const run = {
    id: 12345,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'lemtel/integration',
    head_sha: revision,
    path: '.github/workflows/lemtel-operations-portal-build.yml@refs/heads/lemtel/integration',
  };
  assert.equal(validateGithubRun(run, 12345, revision), run);
  assert.throws(() => validateGithubRun({ ...run, conclusion: 'failure' }, 12345, revision), /github_actions_run_not_approved/);
  assert.throws(() => validateGithubRun({ ...run, head_sha: 'b'.repeat(40) }, 12345, revision), /github_actions_run_not_approved/);
  assert.equal(artifactDigest(`sha256:${portalDigest}`), portalDigest);
  assert.throws(() => artifactDigest(null), /github_actions_artifact_digest_missing/);
  const chosen = selectGithubArtifact({ artifacts: [{ id: 98765, name: 'lemtel-operations-portal-12345', expired: false, size_in_bytes: 2048, digest: `sha256:${portalDigest}`, workflow_run: { id: 12345 } }] }, 12345);
  assert.equal(chosen.verified_digest, portalDigest);
  assert.throws(() => selectGithubArtifact({ artifacts: [] }, 12345), /validated_portal_artifact_absent/);
  assert.throws(() => selectGithubArtifact({ artifacts: [{ id: 98765, name: 'lemtel-operations-portal-12345', expired: true, size_in_bytes: 2048, digest: `sha256:${portalDigest}` }] }, 12345), /github_actions_artifact_not_approved/);
});

test('CLI is GitHub-Actions-artifact-only and has no deployment, activation, route, JWT-bypass, provider, telephony, or failover action', () => {
  for (const required of [
    '--github-run-id', '--source-revision', 'repos/${REPOSITORY}/actions/runs/${githubRunId}',
    'github_actions_artifact_digest_mismatch', 'github_actions_artifact_write_failed', 'actions/artifacts/${artifact.id}/zip', 'writeFileSync(zip, downloadedZip', 'sha256(readFileSync(zip))',
    'deployment_executed: false', 'activation_executed: false', 'collector_timer_enabled: false',
    'global_jwt_bypass: false', 'gateway_route_changed: false', 'hostinger_contacted: false',
    'cloudflare_contacted: false', 'telephony_contacted: false', 'failover_contacted: false',
  ]) assert.ok(generator.includes(required), `missing ${required}`);
  assert.doesNotMatch(generator, /--portal-dir|reviewed-static-dir|vite\s+build|npm\s+(?:run|ci)|systemctl|docker|caddy|nsupdate|pg_promote|verify_jwt\s*=\s*false/iu);
  assert.doesNotMatch(generator, /\b(?:curl|wget|ssh|scp|rsync|doctl|hcloud)\b/iu);
});
