#!/usr/bin/env node
/**
 * Seals a root-only, DO-writer-only signed-node-enrollment prerequisite package.
 * This program is offline: it reads only the checked-out detached Git revision and
 * writes an archive. It has no subprocess, network, deployment, runtime or secret action.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
// These two manifests are bundled but cannot hash themselves in their own
// source manifests. They are pinned to origin/lemtel/integration cb9c175...
const DEPLOYMENT_MANIFEST_SHA256 = 'ea24b4008d6c89aa33c8c212b38282de0e9348be3b22806bea8439e5096fe17e';
const ONBOARDING_MANIFEST_SHA256 = 'aab5f0fc2ceaf218f323113982a2b23bd2f1ef1ed0539c7c04ce8b2fa80951f1';

/** Payload names are the exact archive allowlist; manifest.sha256 is added separately. */
export const PACKAGE_FILES = [
  '0021_lemtel_node_secure_enrollment.sql',
  'deployment-metadata.json',
  'lemtel-node-enrollment-admin.index.ts',
  'lemtel-node-enrollment-admin.manifest.json',
  'lemtel-node-enrollment.index.ts',
  'lemtel-node-enrollment.manifest.json',
  'lemtel-node-secure-enrollment-manifest.json',
  'lemtel-node-status-signed-ingest.index.ts',
  'lemtel-node-status-signed-ingest.manifest.json',
  'lemtel-onboarding-admin.index.ts',
  'lemtel-onboarding-admin.manifest.json',
  'lemtelNodeEnrollment.ts',
  'lemtelNodeEnrollmentBackend.ts',
];

const SOURCE_FILES = new Map([
  ['0021_lemtel_node_secure_enrollment.sql', 'infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql'],
  ['lemtelNodeEnrollment.ts', 'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts'],
  ['lemtelNodeEnrollmentBackend.ts', 'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollmentBackend.ts'],
  ['lemtel-node-enrollment.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.ts'],
  ['lemtel-node-enrollment.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/manifest.json'],
  ['lemtel-node-enrollment-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/index.ts'],
  ['lemtel-node-enrollment-admin.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/manifest.json'],
  ['lemtel-node-status-signed-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/index.ts'],
  ['lemtel-node-status-signed-ingest.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/manifest.json'],
  ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
  ['lemtel-onboarding-admin.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json'],
  ['lemtel-node-secure-enrollment-manifest.json', 'infra/lemtel-resilience/node-secure-enrollment/deployment-manifest.json'],
]);

const REQUIRED_MANIFEST_SOURCES = new Map([
  ['0021_lemtel_node_secure_enrollment.sql', 'infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql'],
  ['lemtelNodeEnrollment.ts', 'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts'],
  ['lemtelNodeEnrollmentBackend.ts', 'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollmentBackend.ts'],
  ['lemtel-node-enrollment.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.ts'],
  ['lemtel-node-enrollment.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment/manifest.json'],
  ['lemtel-node-enrollment-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/index.ts'],
  ['lemtel-node-enrollment-admin.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/manifest.json'],
  ['lemtel-node-status-signed-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/index.ts'],
  ['lemtel-node-status-signed-ingest.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/manifest.json'],
  ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
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
const usage = () => 'usage: node scripts/lemtel-node-secure-enrollment-deploy-package.mjs --source-revision <40-hex-git-revision> --output <absolute-package.tar>';

export function parseArgs(argv) {
  if (argv.length !== 4) fail('usage_invalid', false);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--source-revision', '--output'].includes(key) || typeof value !== 'string' || !value || key in values) fail('usage_invalid', false);
    values[key] = value;
  }
  if (!SOURCE_REVISION_RE.test(values['--source-revision'])) fail('source_revision_invalid', false);
  if (!isAbsolute(values['--output']) || values['--output'].includes('\0')) fail('output_path_invalid', false);
  return { sourceRevision: values['--source-revision'], output: resolve(values['--output']) };
}

export function normalizedPath(value) {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) fail('unsafe_path', false);
  return value;
}

function gitMetadataDirectory(root) {
  const dotGit = join(root, '.git');
  try {
    const stat = lstatSync(dotGit);
    if (stat.isDirectory()) return dotGit;
    if (!stat.isFile() || stat.isSymbolicLink()) fail('source_revision_metadata_unavailable');
    const value = readFileSync(dotGit, 'utf8').trim();
    if (!value.startsWith('gitdir: ')) fail('source_revision_metadata_unavailable');
    const directory = resolve(dirname(dotGit), value.slice('gitdir: '.length));
    if (!lstatSync(directory).isDirectory()) fail('source_revision_metadata_unavailable');
    return directory;
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('source_revision_metadata_unavailable');
  }
}

/** The package must be made from a detached worktree at exactly the declared SHA. */
export function checkedOutRevision(root = ROOT) {
  try {
    const head = readFileSync(join(gitMetadataDirectory(root), 'HEAD'), 'utf8').trim();
    if (!SOURCE_REVISION_RE.test(head)) fail('source_revision_not_detached');
    return head;
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('source_revision_metadata_unavailable');
  }
}

export function sourceAtRevision(sourceRevision, source, root = ROOT) {
  if (checkedOutRevision(root) !== sourceRevision) fail('source_revision_not_checked_out');
  const safe = normalizedPath(source);
  const repository = resolve(root);
  const path = resolve(repository, safe);
  if (!path.startsWith(`${repository}/`)) fail('unsafe_path', false);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) fail('source_revision_content_unavailable');
    return readFileSync(path);
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('source_revision_content_unavailable');
  }
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

/** Portable ustar archive: fixed ownership, mode and timestamp; regular files only. */
export function deterministicTar(entries) {
  const seen = new Set();
  const chunks = [];
  for (const entry of [...entries].sort((left, right) => comparePaths(left.path, right.path))) {
    const path = normalizedPath(entry.path);
    if (seen.has(path)) fail('duplicate_archive_path', false);
    seen.add(path);
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    chunks.push(tarHeader(path, bytes, entry.mode ?? 0o644), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function sourceDigestLookup(manifest) {
  if (!manifest || typeof manifest !== 'object') fail('enrollment_manifest_invalid');
  const values = new Map();
  for (const section of ['migration_sources', 'edge_sources', 'dependencies']) {
    if (!Array.isArray(manifest[section])) fail('enrollment_manifest_invalid');
    for (const item of manifest[section]) {
      if (!item || typeof item.path !== 'string' || !SHA256_RE.test(item.sha256 ?? '') || values.has(item.path)) fail('enrollment_manifest_invalid');
      values.set(item.path, item.sha256);
    }
  }
  return values;
}

function validateOnboardingManifest(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== ONBOARDING_MANIFEST_SHA256) fail('onboarding_manifest_digest_mismatch');
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.scope !== 'offline_function_source_only' || manifest.deployment_authorized !== false || manifest.client_cutover_authorized !== false
        || !Array.isArray(manifest.explicitly_excluded) || !manifest.explicitly_excluded.includes('automatic_failover')) fail('onboarding_manifest_invalid');
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('onboarding_manifest_invalid');
  }
}

function validateSourceManifest(files) {
  let manifest;
  const manifestBytes = files.get('lemtel-node-secure-enrollment-manifest.json');
  if (!Buffer.isBuffer(manifestBytes) || sha256(manifestBytes) !== DEPLOYMENT_MANIFEST_SHA256) fail('enrollment_manifest_digest_mismatch');
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { fail('enrollment_manifest_invalid'); }
  if (manifest.package_version !== 'lemtel_node_secure_enrollment_source_package_v1'
      || manifest.scope !== 'lemtel_only_offline_publication_enrollment'
      || manifest.deployment_authorized !== false || manifest.activation_authorized !== false
      || manifest.schema_apply_authorized !== false || manifest.remote_commands_authorized !== false) fail('enrollment_manifest_invalid');
  const expected = sourceDigestLookup(manifest);
  for (const [destination, source] of REQUIRED_MANIFEST_SOURCES) {
    const bytes = files.get(destination);
    if (!bytes || sha256(bytes) !== expected.get(source)) fail('enrollment_source_manifest_mismatch');
  }
  validateOnboardingManifest(files.get('lemtel-onboarding-admin.manifest.json'));
}

function metadata(sourceRevision) {
  return Buffer.from(`${JSON.stringify({
    package_format: 'lemtel_node_secure_enrollment_do_writer_package_v1',
    scope: 'do_writer_signed_node_enrollment_server_prerequisites',
    source_revision: sourceRevision,
    target_role: 'digitalocean_writer',
    snapshot_attestation_required: true,
    node_status_schema_prerequisite: '0020_lemtel_node_status_observations.sql',
    node_status_schema_apply: false,
    schema_migration: '0021_lemtel_node_secure_enrollment.sql',
    schema_apply_idempotent: true,
    edge_runtime_restart_required: true,
    secrets_in_bundle: false,
    secret_configuration_written: false,
    publisher_configuration_written: false,
    publisher_installed: false,
    publisher_timer_enabled: false,
    agent_installed: false,
    agent_activated: false,
    service_activated: false,
    timer_activated: false,
    standby_runtime_started: false,
    caddy_changed: false,
    routes_changed: false,
    provider_contacted: false,
    cloudflare_or_dns_changed: false,
    promotion_executed: false,
    fencing_executed: false,
    automatic_failover_enabled: false,
    telephony_contacted: false,
    business_data_read: false,
    deployment_authorized: false,
    activation_authorized: false,
  }, null, 2)}\n`, 'utf8');
}

function validateMetadata(bytes, sourceRevision) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    const required = {
      package_format: 'lemtel_node_secure_enrollment_do_writer_package_v1',
      scope: 'do_writer_signed_node_enrollment_server_prerequisites',
      source_revision: sourceRevision,
      target_role: 'digitalocean_writer',
      snapshot_attestation_required: true,
      node_status_schema_prerequisite: '0020_lemtel_node_status_observations.sql',
      node_status_schema_apply: false,
      schema_migration: '0021_lemtel_node_secure_enrollment.sql',
      schema_apply_idempotent: true,
      edge_runtime_restart_required: true,
    };
    const forbidden = ['secrets_in_bundle', 'secret_configuration_written', 'publisher_configuration_written', 'publisher_installed', 'publisher_timer_enabled', 'agent_installed', 'agent_activated', 'service_activated', 'timer_activated', 'standby_runtime_started', 'caddy_changed', 'routes_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read', 'deployment_authorized', 'activation_authorized'];
    if (anyMismatch(value, required) || forbidden.some((key) => value[key] !== false)) fail('package_metadata_invalid');
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('package_metadata_invalid');
  }
}

function anyMismatch(value, required) {
  return Object.entries(required).some(([key, expected]) => value[key] !== expected);
}

/** Testable offline sealing primitive. sourceReader must return bytes from the checked-out SHA. */
export function assemblePackage({ output, sourceRevision, sourceReader = sourceAtRevision }) {
  if (!SOURCE_REVISION_RE.test(sourceRevision)) fail('source_revision_invalid', false);
  if (!isAbsolute(output) || output.includes('\0')) fail('output_path_invalid', false);
  if (existsSync(output) || existsSync(`${output}.sha256`)) fail('output_already_exists', false);
  const files = new Map();
  for (const [destination, source] of SOURCE_FILES) {
    const bytes = sourceReader(sourceRevision, source);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('source_revision_content_unavailable');
    files.set(destination, bytes);
  }
  validateSourceManifest(files);
  const metadataBytes = metadata(sourceRevision);
  validateMetadata(metadataBytes, sourceRevision);
  files.set('deployment-metadata.json', metadataBytes);

  const paths = [...files.keys()].sort(comparePaths);
  if (JSON.stringify(paths) !== JSON.stringify([...PACKAGE_FILES].sort(comparePaths))) fail('package_allowlist_invalid', false);
  const entries = [...files.entries()].map(([path, bytes]) => ({ path, bytes, mode: 0o644 }));
  const manifest = entries.sort((left, right) => comparePaths(left.path, right.path)).map((entry) => `${sha256(entry.bytes)}  ${entry.path}`).join('\n');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(`${manifest}\n`, 'utf8'), mode: 0o644 });
  const archive = deterministicTar(entries);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  let archiveWritten = false;
  try {
    writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, output);
    archiveWritten = true;
    const archiveSha256 = sha256(archive);
    writeFileSync(`${output}.sha256`, `${archiveSha256}  ${basename(output)}\n`, { mode: 0o600, flag: 'wx' });
    return { archiveSha256, packageFileCount: entries.length };
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary archive remains */ }
    if (archiveWritten) try { unlinkSync(output); } catch { /* preserve original failure */ }
    throw error;
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = assemblePackage(options);
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.packageFileCount, archive_sha256_written: true, deployment_executed: false, source_revision_verified_locally: true, external_contacted: false })}\n`);
  } catch (error) {
    const code = error instanceof PackageError ? error.code : 'unknown';
    const status = error instanceof PackageError && error.blocked ? 'blocked' : 'failed';
    process.stderr.write(`package_status=${status}\nreason=${code}\n${code === 'usage_invalid' ? `${usage()}\n` : ''}`);
    process.exitCode = 64;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
