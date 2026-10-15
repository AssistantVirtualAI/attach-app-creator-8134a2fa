#!/usr/bin/env node
/**
 * Creates a deterministic, offline Lemtel transactional-email deployment package.
 * It never reads environment variables, makes a network request, or accepts secrets.
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/u;
const REQUIRED_PORTAL_ENTRY = 'lemtel-portal.html';
const PACKAGE_FILES = [
  '0019_lemtel_transactional_email_delivery_states.sql',
  'functions/_shared/lemtelTransactionalEmail.ts',
  'functions/lemtel-onboarding-admin/index.ts',
  'functions/lemtel-onboarding-admin/manifest.json',
  'functions/lemtel-password-reset-request/index.ts',
  'functions/lemtel-password-reset-request/manifest.json',
  'functions/lemtel-resend-delivery-webhook/index.ts',
  'functions/lemtel-resend-delivery-webhook/manifest.json',
  'lemtel-transactional-email-do-writer-deploy.sh',
  'portal.tar',
  'deployment-metadata.json',
];
const SOURCE_FILES = new Map([
  ['0019_lemtel_transactional_email_delivery_states.sql', 'infra/lemtel-self-hosted/migrations/0019_lemtel_transactional_email_delivery_states.sql'],
  ['functions/_shared/lemtelTransactionalEmail.ts', 'infra/lemtel-self-hosted/functions/_shared/lemtelTransactionalEmail.ts'],
  ['functions/lemtel-onboarding-admin/index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
  ['functions/lemtel-onboarding-admin/manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/manifest.json'],
  ['functions/lemtel-password-reset-request/index.ts', 'infra/lemtel-self-hosted/functions/lemtel-password-reset-request/index.ts'],
  ['functions/lemtel-password-reset-request/manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-password-reset-request/manifest.json'],
  ['functions/lemtel-resend-delivery-webhook/index.ts', 'infra/lemtel-self-hosted/functions/lemtel-resend-delivery-webhook/index.ts'],
  ['functions/lemtel-resend-delivery-webhook/manifest.json', 'infra/lemtel-self-hosted/functions/lemtel-resend-delivery-webhook/manifest.json'],
  ['lemtel-transactional-email-do-writer-deploy.sh', 'infra/lemtel-self-hosted/transactional-email-deploy/lemtel-transactional-email-do-writer-deploy.sh'],
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const usage = () => 'usage: node scripts/lemtel-transactional-email-deploy-package.mjs --portal-dir <reviewed-static-dir> --output <package.tar> --source-revision <40-hex-git-revision>';
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function parseArgs(argv) {
  if (argv.length !== 6) fail(usage());
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--portal-dir', '--output', '--source-revision'].includes(key) || !value || key in result) fail(usage());
    result[key] = value;
  }
  if (!result['--portal-dir'] || !result['--output'] || !result['--source-revision']) fail(usage());
  return { portalDir: resolve(result['--portal-dir']), output: resolve(result['--output']), sourceRevision: result['--source-revision'] };
}

function normalizedPath(value) {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) fail('unsafe_path');
  return value;
}

function octal(value, width) {
  const encoded = value.toString(8);
  if (encoded.length + 1 > width) fail('tar_field_overflow');
  return `${encoded.padStart(width - 1, '0')}\0`;
}

function writeField(header, offset, width, text) {
  const value = Buffer.from(text, 'utf8');
  if (value.length > width) fail('tar_name_too_long');
  value.copy(header, offset);
}

function splitTarPath(path) {
  const value = normalizedPath(path);
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: '' };
  const slash = value.lastIndexOf('/');
  if (slash <= 0) fail('tar_name_too_long');
  const prefix = value.slice(0, slash);
  const name = value.slice(slash + 1);
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) fail('tar_name_too_long');
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

function regularFiles(root) {
  const result = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort(comparePaths)) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail('portal_symlink_forbidden');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        const rel = relative(root, path).split(sep).join('/');
        result.push({ path: normalizedPath(rel), bytes: readFileSync(path), mode: 0o644 });
      } else fail('portal_non_regular_file_forbidden');
    }
  };
  walk(root);
  return result;
}

function checkedPortalEntries(portalDir) {
  let stat;
  try { stat = statSync(portalDir); } catch { fail('portal_directory_missing'); }
  if (!stat.isDirectory()) fail('portal_directory_not_directory');
  const files = regularFiles(portalDir);
  if (!files.some((entry) => entry.path === REQUIRED_PORTAL_ENTRY)) fail('portal_entry_missing');
  if (!files.some((entry) => entry.path.startsWith('assets/'))) fail('portal_assets_missing');
  return files;
}

function metadata(sourceRevision) {
  return Buffer.from(`${JSON.stringify({
    package_format: 'lemtel_transactional_email_do_writer_package_v1',
    scope: 'lemtel_transactional_email_repair_only',
    source_revision: sourceRevision,
    target_role: 'digitalocean_writer',
    hostinger_touched: false,
    cloudflare_or_dns_touched: false,
    telephony_touched: false,
    secrets_in_bundle: false,
    send_email_during_install: false,
    trigger_password_reset_during_install: false,
    enable_resend_webhook_during_install: false,
    resend_secret_tty_injection: 'not_supported_by_documented_edge_runtime',
  }, null, 2)}\n`, 'utf8');
}

export function buildPackage({ portalDir, output, sourceRevision }, root = ROOT) {
  if (!SOURCE_REVISION_RE.test(sourceRevision)) fail('source_revision_invalid');
  const entries = [];
  for (const [destination, source] of SOURCE_FILES) {
    const absolute = resolve(root, source);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('source_file_invalid');
    entries.push({ path: destination, bytes: readFileSync(absolute), mode: destination.endsWith('.sh') ? 0o755 : 0o644 });
  }
  entries.push({ path: 'portal.tar', bytes: deterministicTar(checkedPortalEntries(portalDir)), mode: 0o644 });
  entries.push({ path: 'deployment-metadata.json', bytes: metadata(sourceRevision), mode: 0o644 });
  const paths = entries.map((entry) => entry.path).sort(comparePaths);
  if (JSON.stringify(paths) !== JSON.stringify([...PACKAGE_FILES].sort(comparePaths))) fail('package_allowlist_invalid');
  const manifest = entries
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((entry) => `${sha256(entry.bytes)}  ${entry.path}`)
    .join('\n');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(`${manifest}\n`, 'utf8'), mode: 0o644 });
  const archive = deterministicTar(entries);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, output);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary file to remove */ }
    throw error;
  }
  const archiveName = output.split('/').pop();
  const digest = sha256(archive);
  writeFileSync(`${output}.sha256`, `${digest}  ${archiveName}\n`, { mode: 0o600 });
  return { archiveSha256: digest, packageFileCount: entries.length, portalFileCount: checkedPortalEntries(portalDir).length };
}

function main() {
  try {
    const result = buildPackage(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ package_status: 'created', package_file_count: result.packageFileCount, portal_file_count: result.portalFileCount, archive_sha256_written: true })}\n`);
  } catch (error) {
    process.stderr.write(`package_status=failed\nreason=${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exitCode = 64;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
