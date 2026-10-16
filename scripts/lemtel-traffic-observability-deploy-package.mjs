#!/usr/bin/env node
/**
 * Seals an offline Lemtel traffic-observability deployment archive.
 * The CLI retrieves its portal only from a successful, digest-verified GitHub
 * Actions artifact. It never invokes the deployer, collector, route applier,
 * any provider, or any runtime command.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPOSITORY = 'AssistantVirtualAI/attach-app-creator-8134a2fa';
const INTEGRATION_BRANCH = 'lemtel/integration';
const WORKFLOW_PATH = '.github/workflows/lemtel-operations-portal-build.yml';
const ARTIFACT_PREFIX = 'lemtel-operations-portal-';
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/u;
const RUN_ID_RE = /^[1-9][0-9]{0,18}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const REQUIRED_PORTAL_ENTRY = 'lemtel-portal.html';
const MAX_PORTAL_FILES = 100;
const MAX_PORTAL_BYTES = 25 * 1024 * 1024;

// These names deliberately match only the files consumed by the existing DO-writer deployer.
export const PACKAGE_FILES = [
  '0017_lemtel_traffic_samples.sql',
  'deployment-metadata.json',
  'lemtel-onboarding-admin.index.ts',
  'lemtel-onboarding-admin.manifest.json',
  'lemtel-traffic-ingest.index.ts',
  'lemtel-traffic-ingest.manifest.json',
  'portal.tar',
];

const SOURCE_FILES = new Map([
  ['0017_lemtel_traffic_samples.sql', 'infra/lemtel-self-hosted/migrations/0017_lemtel_traffic_samples.sql'],
  ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
  ['lemtel-onboarding-admin.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json'],
  ['lemtel-traffic-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts'],
  ['lemtel-traffic-ingest.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/manifest.json'],
]);

class PackageError extends Error {
  constructor(code, blocked = true) {
    super(code);
    this.code = code;
    this.blocked = blocked;
  }
}

const fail = (code, blocked = true) => { throw new PackageError(code, blocked); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const usage = () => 'usage: node scripts/lemtel-traffic-observability-deploy-package.mjs --github-run-id <run-id> --source-revision <40-hex-git-revision> --output <package.tar>';

function parseArgs(argv) {
  if (argv.length !== 6) fail('usage_invalid', false);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--github-run-id', '--source-revision', '--output'].includes(key) || !value || key in values) fail('usage_invalid', false);
    values[key] = value;
  }
  if (!RUN_ID_RE.test(values['--github-run-id'])) fail('github_run_id_invalid', false);
  if (!SOURCE_REVISION_RE.test(values['--source-revision'])) fail('source_revision_invalid', false);
  return {
    githubRunId: values['--github-run-id'],
    sourceRevision: values['--source-revision'],
    output: resolve(values['--output']),
  };
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

function splitTarPath(path) {
  const value = normalizedPath(path);
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: '' };
  const slash = value.lastIndexOf('/');
  if (slash <= 0) fail('tar_name_too_long', false);
  const prefix = value.slice(0, slash);
  const name = value.slice(slash + 1);
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) fail('tar_name_too_long', false);
  return { name, prefix };
}

function tarHeader(path, bytes, mode = 0o644) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(path);
  writeField(header, 0, 100, name);
  writeField(header, 100, 8, octal(mode, 8));
  writeField(header, 108, 8, octal(0, 8));
  writeField(header, 116, 8, octal(0, 8));
  writeField(header, 124, 12, octal(bytes.length, 12));
  writeField(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeField(header, 257, 6, 'ustar');
  writeField(header, 263, 2, '00');
  writeField(header, 329, 8, octal(0, 8));
  writeField(header, 337, 8, octal(0, 8));
  writeField(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/** Create a portable ustar archive with fixed ownership, mtime, modes, ordering and no links. */
export function deterministicTar(entries) {
  const chunks = [];
  for (const entry of [...entries].sort((left, right) => comparePaths(left.path, right.path))) {
    const path = normalizedPath(entry.path);
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    chunks.push(tarHeader(path, bytes, entry.mode ?? 0o644), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function portalAssetPath(path) {
  return /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,191}\.(?:css|js|woff2?|ttf|svg|png|jpe?g|webp)$/u.test(path);
}

function checkedPortalEntriesFromEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_PORTAL_FILES) fail('portal_artifact_files_invalid');
  const paths = new Set();
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !Buffer.isBuffer(entry.bytes)) fail('portal_artifact_files_invalid');
    const path = normalizedPath(entry.path);
    if (paths.has(path) || (path !== REQUIRED_PORTAL_ENTRY && !portalAssetPath(path))) fail('portal_artifact_files_invalid');
    paths.add(path);
    totalBytes += entry.bytes.length;
  }
  if (!paths.has(REQUIRED_PORTAL_ENTRY) || ![...paths].some(portalAssetPath) || totalBytes > MAX_PORTAL_BYTES) fail('portal_artifact_files_invalid');
  return [...entries].map((entry) => ({ path: entry.path, bytes: Buffer.from(entry.bytes), mode: 0o644 }));
}

function portalEntriesFromDirectory(directory) {
  const entries = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort(comparePaths)) {
      const absolute = resolve(current, name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail('portal_artifact_symlink_forbidden');
      if (metadata.isDirectory()) walk(absolute);
      else if (metadata.isFile()) {
        const path = relative(directory, absolute).split(sep).join('/');
        entries.push({ path, bytes: readFileSync(absolute), mode: 0o644 });
      } else fail('portal_artifact_non_regular_file');
    }
  };
  walk(directory);
  return checkedPortalEntriesFromEntries(entries);
}

function ghJson(endpoint) {
  let stdout;
  try {
    stdout = execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail('github_actions_metadata_unavailable');
  }
  // Some managed gh configurations force ANSI color even when stdout is a pipe.
  // Strip only CSI terminal sequences before parsing; all provenance checks remain exact.
  const json = stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');
  try { return JSON.parse(json); } catch { fail('github_actions_metadata_invalid'); }
}

export function validateGithubRun(run, runId, sourceRevision) {
  if (!run || typeof run !== 'object'
    || String(run.id) !== String(runId)
    || run.status !== 'completed'
    || run.conclusion !== 'success'
    || run.head_branch !== INTEGRATION_BRANCH
    || run.head_sha !== sourceRevision
    || typeof run.path !== 'string'
    || run.path.split('@', 1)[0] !== WORKFLOW_PATH) fail('github_actions_run_not_approved');
  return run;
}

export function artifactDigest(value) {
  if (typeof value !== 'string' || !value.startsWith('sha256:') || !SHA256_RE.test(value.slice('sha256:'.length))) fail('github_actions_artifact_digest_missing');
  return value.slice('sha256:'.length);
}

export function selectGithubArtifact(payload, runId) {
  const artifacts = payload && Array.isArray(payload.artifacts) ? payload.artifacts : null;
  if (!artifacts) fail('github_actions_artifact_metadata_invalid');
  const expectedName = `${ARTIFACT_PREFIX}${runId}`;
  const matches = artifacts.filter((artifact) => artifact && artifact.name === expectedName);
  if (matches.length === 0) fail('validated_portal_artifact_absent');
  if (matches.length !== 1) fail('validated_portal_artifact_ambiguous');
  const artifact = matches[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > MAX_PORTAL_BYTES) fail('github_actions_artifact_not_approved');
  if (artifact.workflow_run && String(artifact.workflow_run.id) !== String(runId)) fail('github_actions_artifact_run_mismatch');
  return { ...artifact, verified_digest: artifactDigest(artifact.digest) };
}

function listZipEntries(zip) {
  let names;
  try { names = execFileSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { fail('github_actions_artifact_zip_invalid'); }
  const entries = names.split('\n').filter(Boolean);
  if (entries.length === 0 || entries.length > MAX_PORTAL_FILES + 5) fail('github_actions_artifact_zip_invalid');
  for (const name of entries) {
    const withoutTrailingSlash = name.endsWith('/') ? name.slice(0, -1) : name;
    if (!withoutTrailingSlash) fail('github_actions_artifact_zip_invalid');
    normalizedPath(withoutTrailingSlash);
  }
}

function retrievePortalArtifact({ githubRunId, sourceRevision }) {
  const run = validateGithubRun(
    ghJson(`repos/${REPOSITORY}/actions/runs/${githubRunId}`),
    githubRunId,
    sourceRevision,
  );
  const artifact = selectGithubArtifact(
    ghJson(`repos/${REPOSITORY}/actions/runs/${githubRunId}/artifacts?per_page=100`),
    githubRunId,
  );
  const temporary = mkdtempSync(join(tmpdir(), 'lemtel-traffic-portal-artifact-'));
  const zip = join(temporary, 'portal.zip');
  const extracted = join(temporary, 'extracted');
  try {
    let downloadedZip;
    try { downloadedZip = execFileSync('gh', ['api', `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`, '--method', 'GET'], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { fail('github_actions_artifact_download_failed'); }
    try { writeFileSync(zip, downloadedZip, { mode: 0o600, flag: 'wx' }); }
    catch { fail('github_actions_artifact_write_failed'); }
    if (!existsSync(zip) || !lstatSync(zip).isFile() || sha256(readFileSync(zip)) !== artifact.verified_digest) fail('github_actions_artifact_digest_mismatch');
    listZipEntries(zip);
    mkdirSync(extracted, { mode: 0o700 });
    try { execFileSync('unzip', ['-qq', zip, '-d', extracted], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { fail('github_actions_artifact_zip_invalid'); }
    return {
      portalEntries: portalEntriesFromDirectory(extracted),
      provenance: {
        github_repository: REPOSITORY,
        github_workflow: WORKFLOW_PATH,
        github_run_id: Number(githubRunId),
        github_run_head_sha: run.head_sha,
        github_artifact_id: artifact.id,
        github_artifact_name: artifact.name,
        github_artifact_sha256: artifact.verified_digest,
      },
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function sourceAtRevision(sourceRevision, source, root = ROOT) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${sourceRevision}:${source}`], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { fail('source_revision_content_unavailable'); }
}

function metadata(sourceRevision, provenance) {
  return Buffer.from(`${JSON.stringify({
    package_format: 'lemtel_traffic_observability_do_writer_package_v1',
    scope: 'lemtel_traffic_observability',
    source_revision: sourceRevision,
    target_role: 'digitalocean_writer',
    github_actions_portal_artifact: provenance,
    secrets_in_bundle: false,
    personal_data_in_bundle: false,
    ip_addresses_in_bundle: false,
    traffic_content_in_bundle: false,
    collector_activation: false,
    collector_timer_enabled: false,
    gateway_route_changed: false,
    global_jwt_bypass: false,
    automatic_failover_enabled: false,
    hostinger_contacted: false,
    cloudflare_contacted: false,
    telephony_contacted: false,
    failover_contacted: false,
    deployment_authorized: false,
    activation_authorized: false,
  }, null, 2)}\n`, 'utf8');
}

/**
 * Testable sealing primitive. The command-line entrypoint supplies portalEntries
 * exclusively through retrievePortalArtifact; it intentionally accepts no local portal path.
 */
export function assemblePackage({ output, sourceRevision, provenance, portalEntries, sourceReader = sourceAtRevision }) {
  if (!SOURCE_REVISION_RE.test(sourceRevision)) fail('source_revision_invalid', false);
  if (!provenance || provenance.github_run_head_sha !== sourceRevision || !SHA256_RE.test(provenance.github_artifact_sha256 ?? '')) fail('github_actions_provenance_invalid');
  if (existsSync(output) || existsSync(`${output}.sha256`)) fail('output_already_exists', false);
  const entries = [];
  for (const [destination, source] of SOURCE_FILES) {
    const bytes = sourceReader(sourceRevision, source);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('source_revision_content_unavailable');
    entries.push({ path: destination, bytes, mode: 0o644 });
  }
  entries.push({ path: 'portal.tar', bytes: deterministicTar(checkedPortalEntriesFromEntries(portalEntries)), mode: 0o644 });
  entries.push({ path: 'deployment-metadata.json', bytes: metadata(sourceRevision, provenance), mode: 0o644 });
  const paths = entries.map((entry) => entry.path).sort(comparePaths);
  if (JSON.stringify(paths) !== JSON.stringify([...PACKAGE_FILES].sort(comparePaths))) fail('package_allowlist_invalid', false);
  const manifest = entries
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((entry) => `${sha256(entry.bytes)}  ${entry.path}`)
    .join('\n');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(`${manifest}\n`, 'utf8'), mode: 0o644 });
  const archive = deterministicTar(entries);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  let archiveWritten = false;
  try {
    writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, output);
    archiveWritten = true;
    const digest = sha256(archive);
    writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`, { mode: 0o600, flag: 'wx' });
    return { archiveSha256: digest, packageFileCount: entries.length, portalFileCount: portalEntries.length };
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary archive remains */ }
    if (archiveWritten) try { unlinkSync(output); } catch { /* preserve the original error */ }
    throw error;
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { portalEntries, provenance } = retrievePortalArtifact(options);
    const result = assemblePackage({ ...options, portalEntries, provenance });
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.packageFileCount, portal_file_count: result.portalFileCount, archive_sha256_written: true, deployment_executed: false, activation_executed: false })}\n`);
  } catch (error) {
    const code = error instanceof PackageError ? error.code : 'unknown';
    const status = error instanceof PackageError && error.blocked ? 'blocked' : 'failed';
    process.stderr.write(`package_status=${status}\nreason=${code}\n${code === 'usage_invalid' ? `${usage()}\n` : ''}`);
    process.exitCode = 64;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
