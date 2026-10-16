#!/usr/bin/env node
/**
 * Seals a root-only, DO-writer-only Lemtel node-status observation prerequisite
 * package. This generator is offline: it reads a committed Git revision and
 * writes an archive; it never deploys, activates a publisher, or contacts a
 * provider, runtime, network endpoint, or remote service.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;

export const PACKAGE_FILES = [
  '0020_lemtel_node_status_observations.sql',
  'deployment-metadata.json',
  'lemtel-node-status-ingest.index.ts',
  'lemtel-node-status-ingest.manifest.json',
  'lemtel-node-status-manifest.json',
  'lemtel-onboarding-admin.index.ts',
  'lemtel-onboarding-admin.manifest.json',
];

const SOURCE_FILES = new Map([
  ['0020_lemtel_node_status_observations.sql', 'infra/lemtel-self-hosted/migrations/0020_lemtel_node_status_observations.sql'],
  ['lemtel-node-status-manifest.json', 'infra/lemtel-self-hosted/migrations/lemtel-node-status-manifest.json'],
  ['lemtel-node-status-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/index.ts'],
  ['lemtel-node-status-ingest.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/manifest.json'],
  ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
  ['lemtel-onboarding-admin.manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json'],
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
const usage = () => 'usage: node scripts/lemtel-node-status-observation-deploy-package.mjs --source-revision <40-hex-git-revision> --output <package.tar>';

export function parseArgs(argv) {
  if (argv.length !== 4) fail('usage_invalid', false);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--source-revision', '--output'].includes(key) || !value || key in values) fail('usage_invalid', false);
    values[key] = value;
  }
  if (!SOURCE_REVISION_RE.test(values['--source-revision'])) fail('source_revision_invalid', false);
  return { sourceRevision: values['--source-revision'], output: resolve(values['--output']) };
}

export function normalizedPath(value) {
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

/** Portable ustar archive: stable ordering, fixed ownership/time, regular files only. */
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

export function checkedOutRevision(root = ROOT) {
  try {
    execFileSync('git', ['-C', root, 'symbolic-ref', '-q', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    fail('source_revision_not_detached');
  } catch (error) {
    if (error instanceof PackageError) throw error;
  }
  try {
    const revision = execFileSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!SOURCE_REVISION_RE.test(revision)) fail('source_revision_metadata_unavailable');
    return revision;
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('source_revision_metadata_unavailable');
  }
}

export function sourceAtRevision(sourceRevision, source, root = ROOT) {
  if (checkedOutRevision(root) !== sourceRevision) fail('source_revision_not_checked_out');
  try {
    return execFileSync('git', ['-C', root, 'show', `${sourceRevision}:${source}`], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail('source_revision_content_unavailable');
  }
}

function sourceDigestLookup(manifest) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.migration_sources) || !Array.isArray(manifest.edge_sources)) fail('node_status_manifest_invalid');
  const entries = [...manifest.migration_sources, ...manifest.edge_sources];
  const values = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !SHA256_RE.test(entry.sha256 ?? '') || values.has(entry.path)) fail('node_status_manifest_invalid');
    values.set(entry.path, entry.sha256);
  }
  return values;
}

function validateSourceManifest(files) {
  let manifest;
  try { manifest = JSON.parse(files.get('lemtel-node-status-manifest.json').toString('utf8')); } catch { fail('node_status_manifest_invalid'); }
  if (manifest.package_version !== 'lemtel_node_status_schema_edge_prerequisite_v1' ||
      manifest.scope !== 'offline_lemtel_node_status_schema_and_edge_prerequisite' ||
      manifest.deployment_authorized !== false || manifest.activation_authorized !== false || manifest.schema_apply_authorized !== false) fail('node_status_manifest_invalid');
  const expected = sourceDigestLookup(manifest);
  for (const [destination, source] of SOURCE_FILES) {
    if (destination === 'lemtel-node-status-manifest.json') continue;
    const bytes = files.get(destination);
    const manifestDigest = expected.get(source);
    if (!bytes || !manifestDigest || sha256(bytes) !== manifestDigest) fail('node_status_source_manifest_mismatch');
  }
}

function metadata(sourceRevision) {
  return Buffer.from(`${JSON.stringify({
    package_format: 'lemtel_node_status_observation_do_writer_package_v1',
    scope: 'do_writer_redacted_node_status_observation_prerequisites',
    source_revision: sourceRevision,
    target_role: 'digitalocean_writer',
    snapshot_attestation_required: true,
    schema_migration: '0020_lemtel_node_status_observations.sql',
    schema_apply_idempotent: true,
    edge_runtime_restart_required: true,
    secrets_in_bundle: false,
    publisher_configuration_written: false,
    publisher_installed: false,
    publisher_timer_enabled: false,
    standby_runtime_started: false,
    caddy_changed: false,
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
    if (value.package_format !== 'lemtel_node_status_observation_do_writer_package_v1' ||
        value.scope !== 'do_writer_redacted_node_status_observation_prerequisites' ||
        value.source_revision !== sourceRevision || value.target_role !== 'digitalocean_writer' ||
        value.snapshot_attestation_required !== true || value.schema_migration !== '0020_lemtel_node_status_observations.sql' ||
        value.schema_apply_idempotent !== true || value.edge_runtime_restart_required !== true) fail('package_metadata_invalid');
    for (const key of ['secrets_in_bundle', 'publisher_configuration_written', 'publisher_installed', 'publisher_timer_enabled', 'standby_runtime_started', 'caddy_changed', 'provider_contacted', 'cloudflare_or_dns_changed', 'promotion_executed', 'fencing_executed', 'automatic_failover_enabled', 'telephony_contacted', 'business_data_read', 'deployment_authorized', 'activation_authorized']) if (value[key] !== false) fail('package_metadata_invalid');
  } catch (error) {
    if (error instanceof PackageError) throw error;
    fail('package_metadata_invalid');
  }
}

/** Testable offline sealing primitive. sourceReader must return the committed bytes for a source. */
export function assemblePackage({ output, sourceRevision, sourceReader = sourceAtRevision }) {
  if (!SOURCE_REVISION_RE.test(sourceRevision)) fail('source_revision_invalid', false);
  if (checkedOutRevision() !== sourceRevision) fail('source_revision_not_checked_out');
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
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.packageFileCount, archive_sha256_written: true, deployment_executed: false, publisher_configured: false, publisher_installed: false, publisher_timer_enabled: false, external_contacted: false })}\n`);
  } catch (error) {
    const code = error instanceof PackageError ? error.code : 'unknown';
    const status = error instanceof PackageError && error.blocked ? 'blocked' : 'failed';
    process.stderr.write(`package_status=${status}\nreason=${code}\n${code === 'usage_invalid' ? `${usage()}\n` : ''}`);
    process.exitCode = 64;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
