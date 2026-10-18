#!/usr/bin/env node
/**
 * Seals a static-only Lemtel Operations portal refresh archive.
 * Its only portal input is an immutable GitHub Actions ZIP after native Sigstore
 * provenance is verified both online and against the bundle retained in release.
 * This CLI never deploys or contacts a runtime/infrastructure provider.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'AssistantVirtualAI/attach-app-creator-8134a2fa';
const INTEGRATION_BRANCH = 'lemtel/integration';
const WORKFLOW_PATH = '.github/workflows/lemtel-operations-portal-build.yml';
const ARTIFACT_PREFIX = 'lemtel-operations-portal-';
const ZIP_HELPER = resolve(fileURLToPath(new URL('../infra/lemtel-resilience/active-passive/lemtel-verified-portal-zip.py', import.meta.url)));
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/u;
const RUN_ID_RE = /^[1-9][0-9]{0,18}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_ATTESTATION_BYTES = 10 * 1024 * 1024;
const MAX_TRUSTED_ROOT_BYTES = 10 * 1024 * 1024;

export const PACKAGE_FILES = ['deployment-metadata.json', 'portal-artifact.attestation.jsonl', 'portal-artifact.zip', 'trusted-root.jsonl'];

class PackageError extends Error {
  constructor(code, blocked = true) { super(code); this.code = code; this.blocked = blocked; }
}
const fail = (code, blocked = true) => { throw new PackageError(code, blocked); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const usage = () => 'usage: node scripts/lemtel-operations-portal-static-refresh-package.mjs --github-run-id <run-id> --source-revision <40-hex-git-revision> --output <package.tar>';

function parseArgs(argv) {
  if (argv.length !== 6) fail('usage_invalid', false);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!['--github-run-id', '--source-revision', '--output'].includes(key) || !value || key in values) fail('usage_invalid', false);
    values[key] = value;
  }
  if (!RUN_ID_RE.test(values['--github-run-id']) || !SOURCE_REVISION_RE.test(values['--source-revision'])) fail('usage_invalid', false);
  return { githubRunId: values['--github-run-id'], sourceRevision: values['--source-revision'], output: resolve(values['--output']) };
}
function normalizedPath(value) {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) fail('unsafe_path', false);
  return value;
}
function octal(value, width) {
  const encoded = value.toString(8);
  if (encoded.length + 1 > width) fail('tar_field_overflow', false);
  return `${encoded.padStart(width - 1, '0')}\0`;
}
function writeField(header, offset, width, text) {
  const value = Buffer.from(text, 'utf8');
  if (value.length > width) fail('tar_name_too_long', false);
  value.copy(header, offset);
}
function tarHeader(path, bytes, mode = 0o644) {
  const value = normalizedPath(path);
  if (Buffer.byteLength(value) > 100) fail('tar_name_too_long', false);
  const header = Buffer.alloc(512, 0);
  writeField(header, 0, 100, value); writeField(header, 100, 8, octal(mode, 8));
  writeField(header, 108, 8, octal(0, 8)); writeField(header, 116, 8, octal(0, 8));
  writeField(header, 124, 12, octal(bytes.length, 12)); writeField(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156); header[156] = '0'.charCodeAt(0);
  writeField(header, 257, 6, 'ustar'); writeField(header, 263, 2, '00');
  let checksum = 0; for (const byte of header) checksum += byte;
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}
export function deterministicTar(entries) {
  const names = new Set(); const chunks = [];
  for (const entry of [...entries].sort((left, right) => comparePaths(left.path, right.path))) {
    const path = normalizedPath(entry.path);
    if (names.has(path)) fail('duplicate_archive_path', false);
    names.add(path);
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    chunks.push(tarHeader(path, bytes, entry.mode ?? 0o644), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}
function ghJson(endpoint, execute = execFileSync) {
  let stdout;
  try { stdout = execute('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_actions_metadata_unavailable'); }
  try { return JSON.parse(stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')); }
  catch { fail('github_actions_metadata_invalid'); }
}
export function validateGithubRun(run, runId, sourceRevision) {
  if (!run || typeof run !== 'object' || String(run.id) !== String(runId) || run.status !== 'completed' || run.conclusion !== 'success' || run.head_branch !== INTEGRATION_BRANCH || run.head_sha !== sourceRevision || typeof run.path !== 'string' || run.path.split('@', 1)[0] !== WORKFLOW_PATH) fail('github_actions_run_not_approved');
  return run;
}
export function artifactDigest(value) {
  if (typeof value !== 'string' || !value.startsWith('sha256:') || !SHA256_RE.test(value.slice(7))) fail('github_actions_artifact_digest_missing');
  return value.slice(7);
}
export function selectGithubArtifact(payload, runId) {
  const artifacts = payload && Array.isArray(payload.artifacts) ? payload.artifacts : null;
  if (!artifacts) fail('github_actions_artifact_metadata_invalid');
  const matches = artifacts.filter((artifact) => artifact && artifact.name === `${ARTIFACT_PREFIX}${runId}`);
  if (matches.length === 0) fail('validated_portal_artifact_absent');
  if (matches.length !== 1) fail('validated_portal_artifact_ambiguous');
  const artifact = matches[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > MAX_ARTIFACT_ZIP_BYTES || (artifact.workflow_run && String(artifact.workflow_run.id) !== String(runId))) fail('github_actions_artifact_not_approved');
  return { ...artifact, verified_digest: artifactDigest(artifact.digest) };
}
function exactRepositoryIdentifier(repository) {
  const value = repository?.id;
  if (!(Number.isSafeInteger(value) && value > 0) && !(typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value))) fail('github_repository_identifier_invalid');
  return String(value);
}
export function verifyNativeGitHubAttestation({ zip, sourceRevision, execute = execFileSync }) {
  const args = ['attestation', 'verify', zip, '--repo', REPOSITORY, '--signer-workflow', `${REPOSITORY}/${WORKFLOW_PATH}`, '--source-ref', `refs/heads/${INTEGRATION_BRANCH}`, '--source-digest', sourceRevision, '--deny-self-hosted-runners'];
  try { execute('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_native_attestation_verification_failed'); }
}
export function validatePortalZip({ zip, execute = execFileSync }) {
  try { execute('python3', [ZIP_HELPER, '--validate', zip], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_actions_artifact_zip_unsafe'); }
}
function downloadAttestationMaterial({ zip, artifactDigestHex, temporary, execute = execFileSync }) {
  try { execute('gh', ['attestation', 'download', zip, '--repo', REPOSITORY], { cwd: temporary, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_native_attestation_bundle_download_failed'); }
  const bundlePath = join(temporary, `sha256:${artifactDigestHex}.jsonl`);
  if (!existsSync(bundlePath) || !lstatSync(bundlePath).isFile() || lstatSync(bundlePath).isSymbolicLink() || lstatSync(bundlePath).size < 1 || lstatSync(bundlePath).size > MAX_ATTESTATION_BYTES) fail('github_native_attestation_bundle_invalid');
  let trustedRoot;
  try { trustedRoot = execute('gh', ['attestation', 'trusted-root'], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_native_trusted_root_download_failed'); }
  if (!Buffer.isBuffer(trustedRoot) || trustedRoot.length < 1 || trustedRoot.length > MAX_TRUSTED_ROOT_BYTES) fail('github_native_trusted_root_invalid');
  const trustedRootPath = join(temporary, 'trusted-root.jsonl');
  writeFileSync(trustedRootPath, trustedRoot, { mode: 0o600, flag: 'wx' });
  return { attestationBundle: readFileSync(bundlePath), trustedRoot: readFileSync(trustedRootPath), bundlePath, trustedRootPath };
}
export function verifyOfflineGitHubAttestation({ zip, bundle, trustedRoot, sourceRevision, repositoryIdentifier, execute = execFileSync }) {
  const args = ['attestation', 'verify', zip, '--repo', REPOSITORY, '--bundle', bundle, '--custom-trusted-root', trustedRoot, '--signer-workflow', `${REPOSITORY}/${WORKFLOW_PATH}`, '--source-ref', `refs/heads/${INTEGRATION_BRANCH}`, '--source-digest', sourceRevision, '--deny-self-hosted-runners', '--format', 'json', '--jq', '.[].verificationResult.signature.certificate.sourceRepositoryIdentifier'];
  let output;
  try { output = execute('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('github_native_attestation_offline_verification_failed'); }
  const identifiers = output.trim().split('\n').filter(Boolean);
  if (identifiers.length === 0 || identifiers.some((value) => value !== repositoryIdentifier)) fail('github_native_attestation_repository_identifier_mismatch');
}

/** Production path: validates run, ZIP digest, safe central directory and online/offline native attestation material. */
export function retrieveVerifiedPortalArtifact({ githubRunId, sourceRevision, execute = execFileSync }) {
  const run = validateGithubRun(ghJson(`repos/${REPOSITORY}/actions/runs/${githubRunId}`, execute), githubRunId, sourceRevision);
  const artifact = selectGithubArtifact(ghJson(`repos/${REPOSITORY}/actions/runs/${githubRunId}/artifacts?per_page=100`, execute), githubRunId);
  const repositoryIdentifier = exactRepositoryIdentifier(ghJson(`repos/${REPOSITORY}`, execute));
  const temporary = mkdtempSync(join(tmpdir(), 'lemtel-static-portal-artifact-'));
  const zip = join(temporary, 'portal-artifact.zip');
  try {
    let downloaded;
    try { downloaded = execute('gh', ['api', `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`, '--method', 'GET'], { encoding: null, maxBuffer: MAX_ARTIFACT_ZIP_BYTES + 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { fail('github_actions_artifact_download_failed'); }
    if (!Buffer.isBuffer(downloaded) || downloaded.length < 1 || downloaded.length > MAX_ARTIFACT_ZIP_BYTES) fail('github_actions_artifact_download_invalid');
    writeFileSync(zip, downloaded, { mode: 0o600, flag: 'wx' });
    if (sha256(downloaded) !== artifact.verified_digest) fail('github_actions_artifact_digest_mismatch');
    validatePortalZip({ zip, execute });
    verifyNativeGitHubAttestation({ zip, sourceRevision, execute });
    const material = downloadAttestationMaterial({ zip, artifactDigestHex: artifact.verified_digest, temporary, execute });
    verifyOfflineGitHubAttestation({ zip, bundle: material.bundlePath, trustedRoot: material.trustedRootPath, sourceRevision, repositoryIdentifier, execute });
    return {
      artifactZip: readFileSync(zip),
      attestationBundle: material.attestationBundle,
      trustedRoot: material.trustedRoot,
      provenance: { github_repository: REPOSITORY, github_repository_identifier: repositoryIdentifier, github_workflow: WORKFLOW_PATH, github_run_id: Number(githubRunId), github_run_head_sha: run.head_sha, github_artifact_id: artifact.id, github_artifact_name: artifact.name, github_artifact_sha256: artifact.verified_digest },
      attestation: { subject_file: 'portal-artifact.zip', bundle_file: 'portal-artifact.attestation.jsonl', trusted_root_file: 'trusted-root.jsonl', verifier: 'gh_attestation_verify', signer_workflow: `${REPOSITORY}/${WORKFLOW_PATH}`, source_ref: `refs/heads/${INTEGRATION_BRANCH}`, source_digest: sourceRevision, source_repository_identifier: repositoryIdentifier, deny_self_hosted_runners: true },
    };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function validBytePayload(value, maximum) { return Buffer.isBuffer(value) && value.length > 0 && value.length <= maximum; }
function metadata(sourceRevision, provenance, attestation) {
  return Buffer.from(`${JSON.stringify({ package_format: 'lemtel_operations_portal_static_refresh_package_v3', scope: 'lemtel_operations_portal_static_refresh', source_revision: sourceRevision, target_role: 'digitalocean_writer', github_actions_portal_artifact: provenance, github_native_attestation: attestation, secrets_in_bundle: false, personal_data_in_bundle: false, ip_addresses_in_bundle: false, traffic_content_in_bundle: false, database_mutation: false, edge_function_mutation: false, caddyfile_mutation: false, portal_static_files_mutation: true, collector_activation: false, collector_timer_enabled: false, gateway_route_changed: false, global_jwt_bypass: false, automatic_failover_enabled: false, hostinger_contacted: false, cloudflare_contacted: false, telephony_contacted: false, failover_contacted: false, deployment_authorized: false }, null, 2)}\n`, 'utf8');
}
/** Pure sealing primitive. The CLI provides only ZIP plus verified native-attestation material. */
export function assembleStaticPortalRefreshPackage({ output, sourceRevision, provenance, attestation, artifactZip, attestationBundle, trustedRoot }) {
  if (!SOURCE_REVISION_RE.test(sourceRevision)) fail('source_revision_invalid', false);
  if (!provenance || provenance.github_run_head_sha !== sourceRevision || !SHA256_RE.test(provenance.github_artifact_sha256 ?? '') || !/^[1-9][0-9]{0,18}$/u.test(provenance.github_repository_identifier ?? '')) fail('github_actions_provenance_invalid');
  if (!attestation || attestation.source_digest !== sourceRevision || attestation.source_ref !== `refs/heads/${INTEGRATION_BRANCH}` || attestation.signer_workflow !== `${REPOSITORY}/${WORKFLOW_PATH}` || attestation.source_repository_identifier !== provenance.github_repository_identifier || attestation.subject_file !== 'portal-artifact.zip' || attestation.bundle_file !== 'portal-artifact.attestation.jsonl' || attestation.trusted_root_file !== 'trusted-root.jsonl' || attestation.deny_self_hosted_runners !== true) fail('github_native_attestation_invalid');
  if (!validBytePayload(artifactZip, MAX_ARTIFACT_ZIP_BYTES) || sha256(artifactZip) !== provenance.github_artifact_sha256 || !validBytePayload(attestationBundle, MAX_ATTESTATION_BYTES) || !validBytePayload(trustedRoot, MAX_TRUSTED_ROOT_BYTES)) fail('github_native_attestation_material_invalid');
  if (existsSync(output) || existsSync(`${output}.sha256`)) fail('output_already_exists', false);
  const entries = [
    { path: 'deployment-metadata.json', bytes: metadata(sourceRevision, provenance, attestation), mode: 0o644 },
    { path: 'portal-artifact.attestation.jsonl', bytes: attestationBundle, mode: 0o644 },
    { path: 'portal-artifact.zip', bytes: artifactZip, mode: 0o644 },
    { path: 'trusted-root.jsonl', bytes: trustedRoot, mode: 0o644 },
  ].sort((left, right) => comparePaths(left.path, right.path));
  const manifest = entries.map((entry) => `${sha256(entry.bytes)}  ${entry.path}`).join('\n');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(`${manifest}\n`, 'utf8'), mode: 0o644 });
  const archive = deterministicTar(entries);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  let archiveWritten = false;
  try {
    writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' }); renameSync(temporary, output); archiveWritten = true;
    const archiveSha256 = sha256(archive);
    writeFileSync(`${output}.sha256`, `${archiveSha256}  ${basename(output)}\n`, { mode: 0o600, flag: 'wx' });
    return { archiveSha256, packageFileCount: entries.length };
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary archive remains */ }
    if (archiveWritten) try { rmSync(output); } catch { /* preserve original error */ }
    throw error;
  }
}
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const input = retrieveVerifiedPortalArtifact(options);
    const result = assembleStaticPortalRefreshPackage({ ...options, ...input });
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.packageFileCount, github_native_attestation_bundle_verified: true, archive_sha256_written: true, deployment_executed: false })}\n`);
  } catch (error) {
    const code = error instanceof PackageError ? error.code : 'unknown';
    const status = error instanceof PackageError && error.blocked ? 'blocked' : 'failed';
    process.stderr.write(`package_status=${status}\nreason=${code}\n${code === 'usage_invalid' ? `${usage()}\n` : ''}`);
    process.exitCode = 64;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
