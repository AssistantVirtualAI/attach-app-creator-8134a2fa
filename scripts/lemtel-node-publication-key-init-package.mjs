#!/usr/bin/env node
/**
 * Seals a root-only local key-initialization package for the two existing
 * Lemtel nodes. This is an offline packaging step: it never deploys, starts
 * a service, configures a secret, publishes an observation, or calls a remote
 * endpoint.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REVISION = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;

export const PACKAGE_FILES = [
  'deployment-metadata.json',
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts',
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.mjs',
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.py',
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-init.sh',
  'infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts',
];

const SOURCES = new Map(PACKAGE_FILES.slice(1).map((path) => [path, path]));

export class PackageError extends Error {
  constructor(code, blocked = true) { super(code); this.code = code; this.blocked = blocked; }
}
const fail = (code, blocked = true) => { throw new PackageError(code, blocked); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const usage = () => 'usage: node scripts/lemtel-node-publication-key-init-package.mjs --source-revision <40-hex-git-revision> --output <absolute-package.tar>';

export function parseArgs(argv) {
  if (argv.length !== 4) fail('usage_invalid', false);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--source-revision', '--output'].includes(key) || !value || key in values) fail('usage_invalid', false);
    values[key] = value;
  }
  if (!REVISION.test(values['--source-revision'])) fail('source_revision_invalid', false);
  return { sourceRevision: values['--source-revision'], output: resolve(values['--output']) };
}

function normalized(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) fail('unsafe_path', false);
  return path;
}
function octal(value, width) {
  const encoded = value.toString(8);
  if (encoded.length + 1 > width) fail('tar_field_overflow', false);
  return `${encoded.padStart(width - 1, '0')}\0`;
}
function text(header, offset, width, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > width) fail('tar_name_too_long', false);
  bytes.copy(header, offset);
}
function tarHeader(path, bytes, mode = 0o644) {
  const safe = normalized(path), header = Buffer.alloc(512, 0);
  if (Buffer.byteLength(safe) > 100) fail('tar_name_too_long', false);
  text(header, 0, 100, safe); text(header, 100, 8, octal(mode, 8)); text(header, 108, 8, octal(0, 8));
  text(header, 116, 8, octal(0, 8)); text(header, 124, 12, octal(bytes.length, 12)); text(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156); header[156] = '0'.charCodeAt(0); text(header, 257, 6, 'ustar'); text(header, 263, 2, '00');
  text(header, 329, 8, octal(0, 8)); text(header, 337, 8, octal(0, 8));
  let checksum = 0; for (const byte of header) checksum += byte;
  text(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}
export function deterministicTar(entries) {
  const seen = new Set(), output = [];
  for (const entry of [...entries].sort((left, right) => compare(left.path, right.path))) {
    const path = normalized(entry.path); if (seen.has(path)) fail('duplicate_archive_path', false); seen.add(path);
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    output.push(tarHeader(path, bytes, entry.mode ?? 0o644), bytes);
    const padding = (512 - (bytes.length % 512)) % 512; if (padding) output.push(Buffer.alloc(padding));
  }
  output.push(Buffer.alloc(1024)); return Buffer.concat(output);
}
export function checkedOutRevision(root = ROOT) {
  try { execFileSync('git', ['-C', root, 'symbolic-ref', '-q', 'HEAD'], { stdio: 'ignore' }); fail('source_revision_not_detached'); }
  catch (error) { if (error instanceof PackageError) throw error; }
  const value = execFileSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!REVISION.test(value)) fail('source_revision_metadata_unavailable'); return value;
}
export function sourceAtRevision(revision, path, root = ROOT) {
  if (checkedOutRevision(root) !== revision) fail('source_revision_not_checked_out');
  try { return execFileSync('git', ['-C', root, 'show', `${revision}:${path}`], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('source_revision_content_unavailable'); }
}
function metadata(sourceRevision) {
  return Buffer.from(`${JSON.stringify({
    package_format: 'lemtel_node_publication_key_init_v1',
    scope: 'root_only_local_public_key_generation',
    source_revision: sourceRevision,
    allowed_roles: ['do_writer', 'hostinger_standby'],
    runtime_key_generation_requires_explicit_local_gate: true,
    runtime_key_generation_authorized_by_package: false,
    local_crypto_runtimes: ['deno_2', 'node_webcrypto_18_or_newer', 'python3_openssl_p256'],
    network_access: false,
    package_install_persistent: false,
    secrets_configured: false,
    publication_configured: false,
    publication_executed: false,
    service_installed: false,
    timer_enabled: false,
    provider_contacted: false,
    cloudflare_or_dns_changed: false,
    promotion_executed: false,
    fencing_executed: false,
    automatic_failover_enabled: false,
    telephony_contacted: false,
  }, null, 2)}\n`, 'utf8');
}
function validateManifest(bytes, sources) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('enrollment_manifest_invalid'); }
  if (manifest.package_version !== 'lemtel_node_secure_enrollment_source_package_v1' || manifest.scope !== 'lemtel_only_offline_publication_enrollment' || manifest.deployment_authorized !== false || manifest.activation_authorized !== false || manifest.runtime_key_generation_authorized !== false) fail('enrollment_manifest_invalid');
  const values = new Map();
  for (const key of ['sources', 'edge_sources', 'validation_sources']) {
    if (!Array.isArray(manifest[key])) fail('enrollment_manifest_invalid');
    for (const entry of manifest[key]) {
      if (!entry || typeof entry.path !== 'string' || !DIGEST.test(entry.sha256 ?? '') || values.has(entry.path)) fail('enrollment_manifest_invalid');
      values.set(entry.path, entry.sha256);
    }
  }
  for (const [path, bytesValue] of sources) if (values.get(path) !== sha256(bytesValue)) fail('enrollment_source_manifest_mismatch');
}
export function assemblePackage({ output, sourceRevision, sourceReader = sourceAtRevision }) {
  if (!REVISION.test(sourceRevision)) fail('source_revision_invalid', false);
  if (checkedOutRevision() !== sourceRevision) fail('source_revision_not_checked_out');
  if (existsSync(output) || existsSync(`${output}.sha256`)) fail('output_already_exists', false);
  const sources = new Map();
  for (const [destination, source] of SOURCES) {
    const bytes = sourceReader(sourceRevision, source);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('source_revision_content_unavailable');
    sources.set(destination, bytes);
  }
  validateManifest(sourceReader(sourceRevision, 'infra/lemtel-resilience/node-secure-enrollment/deployment-manifest.json'), sources);
  const files = new Map(sources); files.set('deployment-metadata.json', metadata(sourceRevision));
  if (JSON.stringify([...files.keys()].sort(compare)) !== JSON.stringify([...PACKAGE_FILES].sort(compare))) fail('package_allowlist_invalid', false);
  const entries = [...files.entries()].map(([path, bytes]) => ({ path, bytes, mode: 0o644 }));
  const manifest = entries.sort((left, right) => compare(left.path, right.path)).map((entry) => `${sha256(entry.bytes)}  ${entry.path}`).join('\n');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(`${manifest}\n`, 'utf8'), mode: 0o644 });
  const archive = deterministicTar(entries); mkdirSync(dirname(output), { recursive: true }); const temporary = `${output}.tmp-${process.pid}`;
  let written = false;
  try {
    writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' }); renameSync(temporary, output); written = true;
    writeFileSync(`${output}.sha256`, `${sha256(archive)}  ${basename(output)}\n`, { mode: 0o600, flag: 'wx' });
    return { archiveSha256: sha256(archive), fileCount: entries.length };
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* preserve original failure */ }
    if (written) try { unlinkSync(output); } catch { /* preserve original failure */ }
    throw error;
  }
}
function main() {
  try {
    const result = assemblePackage(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.fileCount, archive_sha256_written: true, deployment_executed: false, key_generation_executed: false, external_contacted: false })}\n`);
  } catch (error) {
    const code = error instanceof PackageError ? error.code : 'unknown';
    process.stderr.write(`package_status=${error instanceof PackageError && error.blocked ? 'blocked' : 'failed'}\nreason=${code}\n${code === 'usage_invalid' ? `${usage()}\n` : ''}`); process.exitCode = 64;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
