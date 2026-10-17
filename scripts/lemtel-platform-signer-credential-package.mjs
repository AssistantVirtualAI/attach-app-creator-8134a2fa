#!/usr/bin/env node
/** Offline deterministic package for the root-only encrypted platform-signer credential initializer. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REVISION = /^[a-f0-9]{40}$/u;
const SOURCE = [
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.py',
  'infra/lemtel-resilience/node-secure-enrollment/lemtel-platform-signer-credential-init.sh',
  'docs/lemtel-ha/PLATFORM_SIGNER_CREDENTIAL.md',
];
export const PACKAGE_FILES = ['deployment-metadata.json', 'manifest.sha256', ...SOURCE].sort();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'variant' }));

export function parseArgs(argv) {
  if (argv.length !== 4) fail('usage_invalid');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (!['--source-revision', '--output'].includes(name) || !value || Object.hasOwn(values, name)) fail('usage_invalid');
    values[name] = value;
  }
  if (!REVISION.test(values['--source-revision'])) fail('source_revision_invalid');
  if (!isAbsolute(values['--output']) || values['--output'].includes('\0')) fail('output_path_invalid');
  return { sourceRevision: values['--source-revision'], output: resolve(values['--output']) };
}

function gitDirectory(root) {
  const dotGit = resolve(root, '.git');
  const stat = lstatSync(dotGit);
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source_revision_metadata_unavailable');
  const value = readFileSync(dotGit, 'utf8').trim();
  if (!value.startsWith('gitdir: ')) fail('source_revision_metadata_unavailable');
  return resolve(dirname(dotGit), value.slice(8));
}

export function checkedOutRevision(root = ROOT) {
  try {
    const head = readFileSync(resolve(gitDirectory(root), 'HEAD'), 'utf8').trim();
    if (!REVISION.test(head)) fail('source_revision_not_detached');
    return head;
  } catch (error) { if (error?.code) throw error; fail('source_revision_metadata_unavailable'); }
}

function sourceAtRevision(revision, path, root = ROOT) {
  if (checkedOutRevision(root) !== revision || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) fail('source_revision_invalid');
  const target = resolve(root, path);
  if (!target.startsWith(`${root}/`)) fail('unsafe_path');
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) fail('source_revision_content_unavailable');
  return readFileSync(target);
}

function octal(value, width) { const encoded = value.toString(8); if (encoded.length + 1 > width) fail('tar_field_overflow'); return `${encoded.padStart(width - 1, '0')}\0`; }
function field(header, offset, width, value) { const bytes = Buffer.from(value); if (bytes.length > width) fail('tar_field_overflow'); bytes.copy(header, offset); }
function header(path, bytes) {
  const out = Buffer.alloc(512); field(out, 0, 100, path); field(out, 100, 8, octal(0o644, 8)); field(out, 108, 8, octal(0, 8)); field(out, 116, 8, octal(0, 8)); field(out, 124, 12, octal(bytes.length, 12)); field(out, 136, 12, octal(0, 12)); out.fill(0x20, 148, 156); out[156] = 48; field(out, 257, 6, 'ustar'); field(out, 263, 2, '00'); field(out, 329, 8, octal(0, 8)); field(out, 337, 8, octal(0, 8)); let sum = 0; for (const byte of out) sum += byte; field(out, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `); return out;
}
export function tar(entries) {
  const chunks = [];
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path, 'en', { sensitivity: 'variant' }))) {
    if (entry.path.startsWith('/') || entry.path.includes('..') || Buffer.byteLength(entry.path) > 100) fail('archive_path_invalid');
    const bytes = Buffer.from(entry.bytes); chunks.push(header(entry.path, bytes), bytes); const padding = (512 - bytes.length % 512) % 512; if (padding) chunks.push(Buffer.alloc(padding));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

export function assemble({ sourceRevision, output, sourceReader = sourceAtRevision }) {
  if (!REVISION.test(sourceRevision) || !isAbsolute(output) || existsSync(output) || existsSync(`${output}.sha256`)) fail('output_invalid');
  const files = new Map(SOURCE.map((path) => [path, sourceReader(sourceRevision, path)]));
  const metadata = Buffer.from(`${JSON.stringify({ package_format: 'lemtel_platform_signer_credential_package_v1', source_revision: sourceRevision, target_role: 'digitalocean_writer', snapshot_attestation_required: true, network_access: false, plaintext_private_key_written: false, edge_runtime_changed: false, enrollment_enabled: false, node_binding_written: false, publisher_configuration_written: false, service_installed: false, automatic_failover_enabled: false, deployment_authorized: false }, null, 2)}\n`);
  files.set('deployment-metadata.json', metadata);
  const entries = sorted(files.keys()).map((path) => ({ path, bytes: files.get(path) }));
  const manifest = entries.map((entry) => `${sha256(entry.bytes)}  ${entry.path}`).join('\n');
  const archive = tar([...entries, { path: 'manifest.sha256', bytes: `${manifest}\n` }]);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  try { writeFileSync(temporary, archive, { mode: 0o600, flag: 'wx' }); renameSync(temporary, output); writeFileSync(`${output}.sha256`, `${sha256(archive)}  ${basename(output)}\n`, { mode: 0o600, flag: 'wx' }); } catch (error) { rmSync(temporary, { force: true }); rmSync(output, { force: true }); throw error; }
  return { packageFileCount: entries.length + 1, archiveSha256Written: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = assemble(parseArgs(process.argv.slice(2))); process.stdout.write(`${JSON.stringify({ package_status: 'created', ...result, credential_created: false, deployment_executed: false, external_contacted: false })}\n`); }
  catch (error) { process.stderr.write(`package_status=blocked\nreason=${error?.code ?? 'unknown'}\n`); process.exitCode = 64; }
}
