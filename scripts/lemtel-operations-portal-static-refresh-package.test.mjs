import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PACKAGE_FILES, assembleStaticPortalRefreshPackage, verifyNativeGitHubAttestation, verifyOfflineGitHubAttestation } from './lemtel-operations-portal-static-refresh-package.mjs';

const root = resolve(import.meta.dirname, '..');
const generator = readFileSync(resolve(root, 'scripts/lemtel-operations-portal-static-refresh-package.mjs'), 'utf8');
const revision = 'f'.repeat(40);
const artifactDigest = 'a'.repeat(64);
const repositoryIdentifier = '123456789';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactZip = Buffer.from('safe-zip-fixture');
const attestationBundle = Buffer.from('{"mediaType":"application/vnd.dev.sigstore.bundle+json;version=0.3"}\n');
const trustedRoot = Buffer.from('{"mediaType":"application/vnd.dev.sigstore.trustedroot+json;version=0.1"}\n');
const provenance = { github_repository: 'AssistantVirtualAI/attach-app-creator-8134a2fa', github_repository_identifier: repositoryIdentifier, github_workflow: '.github/workflows/lemtel-operations-portal-build.yml', github_run_id: 12345, github_run_head_sha: revision, github_artifact_id: 98765, github_artifact_name: 'lemtel-operations-portal-12345', github_artifact_sha256: hash(artifactZip) };
const attestation = { subject_file: 'portal-artifact.zip', bundle_file: 'portal-artifact.attestation.jsonl', trusted_root_file: 'trusted-root.jsonl', verifier: 'gh_attestation_verify', signer_workflow: 'AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml', source_ref: 'refs/heads/lemtel/integration', source_digest: revision, source_repository_identifier: repositoryIdentifier, deny_self_hosted_runners: true };
const tarList = (archive) => execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();

test('native GitHub attestation verification has exact repository, workflow, ref, commit and runner policy', () => {
  const calls = [];
  const execute = (command, args) => { calls.push([command, args]); return repositoryIdentifier; };
  verifyNativeGitHubAttestation({ zip: '/tmp/portal.zip', sourceRevision: revision, execute });
  verifyOfflineGitHubAttestation({ zip: '/tmp/portal.zip', bundle: '/tmp/bundle.jsonl', trustedRoot: '/tmp/root.jsonl', sourceRevision: revision, repositoryIdentifier, execute });
  assert.deepEqual(calls[0], ['gh', ['attestation', 'verify', '/tmp/portal.zip', '--repo', 'AssistantVirtualAI/attach-app-creator-8134a2fa', '--signer-workflow', 'AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml', '--source-ref', 'refs/heads/lemtel/integration', '--source-digest', revision, '--deny-self-hosted-runners']]);
  assert.deepEqual(calls[1], ['gh', ['attestation', 'verify', '/tmp/portal.zip', '--repo', 'AssistantVirtualAI/attach-app-creator-8134a2fa', '--bundle', '/tmp/bundle.jsonl', '--custom-trusted-root', '/tmp/root.jsonl', '--signer-workflow', 'AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml', '--source-ref', 'refs/heads/lemtel/integration', '--source-digest', revision, '--deny-self-hosted-runners', '--format', 'json', '--jq', '.[].verificationResult.signature.certificate.sourceRepositoryIdentifier']]);
  assert.throws(() => verifyOfflineGitHubAttestation({ zip: '/tmp/portal.zip', bundle: '/tmp/bundle.jsonl', trustedRoot: '/tmp/root.jsonl', sourceRevision: revision, repositoryIdentifier, execute: () => 'other-id' }), /github_native_attestation_repository_identifier_mismatch/);
});

test('static refresh package is reproducible and retains the exact attested ZIP, bundle and trusted root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-static-portal-package-'));
  try {
    const first = join(directory, 'first.tar'); const second = join(directory, 'second.tar');
    const firstResult = assembleStaticPortalRefreshPackage({ output: first, sourceRevision: revision, provenance, attestation, artifactZip, attestationBundle, trustedRoot });
    const secondResult = assembleStaticPortalRefreshPackage({ output: second, sourceRevision: revision, provenance, attestation, artifactZip, attestationBundle, trustedRoot });
    assert.equal(firstResult.archiveSha256, secondResult.archiveSha256);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.equal(firstResult.packageFileCount, PACKAGE_FILES.length + 1);
    assert.deepEqual(tarList(first), [...PACKAGE_FILES, 'manifest.sha256'].sort());
    const unpacked = join(directory, 'unpacked'); mkdirSync(unpacked); execFileSync('tar', ['-xf', first, '-C', unpacked]);
    assert.deepEqual(readFileSync(join(unpacked, 'portal-artifact.zip')), artifactZip);
    assert.deepEqual(readFileSync(join(unpacked, 'portal-artifact.attestation.jsonl')), attestationBundle);
    assert.deepEqual(readFileSync(join(unpacked, 'trusted-root.jsonl')), trustedRoot);
    const manifest = readFileSync(join(unpacked, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.deepEqual(manifest.map((line) => line.slice(66)), [...PACKAGE_FILES].sort());
    for (const line of manifest) { const [entryDigest, file] = line.split('  '); assert.equal(hash(readFileSync(join(unpacked, file))), entryDigest, file); }
    const metadata = JSON.parse(readFileSync(join(unpacked, 'deployment-metadata.json'), 'utf8'));
    assert.equal(metadata.package_format, 'lemtel_operations_portal_static_refresh_package_v3');
    assert.deepEqual(metadata.github_actions_portal_artifact, provenance);
    assert.deepEqual(metadata.github_native_attestation, attestation);
    assert.equal(metadata.portal_static_files_mutation, true);
    for (const key of ['secrets_in_bundle', 'personal_data_in_bundle', 'ip_addresses_in_bundle', 'traffic_content_in_bundle', 'database_mutation', 'edge_function_mutation', 'caddyfile_mutation', 'collector_activation', 'collector_timer_enabled', 'gateway_route_changed', 'global_jwt_bypass', 'automatic_failover_enabled', 'hostinger_contacted', 'cloudflare_contacted', 'telephony_contacted', 'failover_contacted', 'deployment_authorized']) assert.equal(metadata[key], false, key);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('static refresh package rejects missing cryptographic material, mismatched ZIP digest and never writes a partial archive', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-static-portal-invalid-'));
  try {
    const output = join(directory, 'bad.tar');
    assert.throws(() => assembleStaticPortalRefreshPackage({ output, sourceRevision: revision, provenance, attestation, artifactZip, attestationBundle: Buffer.alloc(0), trustedRoot }), /github_native_attestation_material_invalid/);
    assert.equal(existsSync(output), false);
    assert.throws(() => assembleStaticPortalRefreshPackage({ output, sourceRevision: revision, provenance: { ...provenance, github_artifact_sha256: artifactDigest }, attestation, artifactZip, attestationBundle, trustedRoot }), /github_native_attestation_material_invalid/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('package generator requires safe ZIP validation, online verification, bundle download and offline verification before sealing', () => {
  for (const expected of ['validatePortalZip({ zip, execute })', 'verifyNativeGitHubAttestation({ zip, sourceRevision, execute })', 'downloadAttestationMaterial', 'verifyOfflineGitHubAttestation', 'maxBuffer: MAX_ARTIFACT_ZIP_BYTES + 1024 * 1024', "'--bundle'", "'--custom-trusted-root'", "'--deny-self-hosted-runners'", 'github_native_attestation_bundle_verified: true', 'deployment_executed: false']) assert.ok(generator.includes(expected), expected);
  assert.doesNotMatch(generator, /lemtel-traffic-observability-deploy-package|--portal-dir|vite\s+build|npm\s+(?:run|ci)|\b(?:systemctl|docker|psql|curl|wget|ssh|scp|rsync|doctl|hcloud)\b/iu);
});
