#!/usr/bin/env node
// Offline source-only sealing. This entrypoint never executes any packaged source.
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// Pure deterministic ustar encoder; importing it does not invoke the inactive package CLI.
import { deterministicTar } from './lemtel-traffic-observability-deploy-package.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIRECTORY = 'infra/lemtel-resilience/traffic-observability/';
const MANIFEST_PATH = `${DIRECTORY}activation-package-manifest.json`;
export const SHELL_FILES = [
  'lemtel-ha-do-writer-traffic-activation-apply.sh',
  'lemtel-ha-do-writer-traffic-runtime-preflight.sh',
  'lemtel-ha-do-writer-traffic-ingress-route-apply.sh',
  'lemtel-traffic-collect.sh',
  'lemtel-traffic-timer-enable.sh',
];
const DOCUMENT = 'docs/lemtel-ha/TRAFFIC_OBSERVABILITY_ACTIVATION_TRANSACTION.md';
const VALIDATION_SOURCES = ['scripts/lemtel-traffic-activation-package.mjs', 'scripts/lemtel-traffic-activation-transaction.test.mjs'];
export const PACKAGE_FILES = [...SHELL_FILES, 'ACTIVATION_TRANSACTION.md', 'activation-package-manifest.json', 'manifest.sha256'].sort();
const FALSE_KEYS = ['activation_authorized', 'deployment_authorized', 'secrets_in_package', 'database_mutation',
  'hostinger_contacted', 'cloudflare_or_dns_changed', 'automatic_failover_enabled', 'fencing_executed',
  'telephony_contacted', 'credential_values_emitted'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = (condition) => { if (!condition) throw new Error('source_package_refused'); };

function sourceBytes(path) {
  const absolute = resolve(ROOT, path);
  const metadata = lstatSync(absolute);
  require(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.size > 0 && metadata.size <= 1048576);
  return readFileSync(absolute);
}

/** Pure source archive assembly: no output files, commands, networking, environment reads or randomness. */
export function assembleActivationPackage() {
  const manifestBytes = sourceBytes(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  require(manifest.package_format === 'lemtel_do_writer_traffic_activation_source_v1'
    && manifest.target_role === 'digitalocean_writer' && manifest.source_only === true
    && manifest.operator_gated_transaction === true && FALSE_KEYS.every((key) => manifest[key] === false));
  const expectedSources = [...SHELL_FILES.map((name) => DIRECTORY + name), DOCUMENT, ...VALIDATION_SOURCES].sort();
  require(Array.isArray(manifest.sources) && manifest.sources.length === expectedSources.length);
  require(JSON.stringify(manifest.sources.map((item) => item.path).sort()) === JSON.stringify(expectedSources));
  const bytesByPath = new Map();
  for (const item of manifest.sources) {
    require(/^[a-f0-9]{64}$/u.test(item.sha256));
    const bytes = sourceBytes(item.path);
    require(sha256(bytes) === item.sha256);
    bytesByPath.set(item.path, bytes);
  }
  const entries = SHELL_FILES.map((name) => ({ path: name, bytes: bytesByPath.get(DIRECTORY + name), mode: 0o700 }));
  entries.push({ path: 'ACTIVATION_TRANSACTION.md', bytes: bytesByPath.get(DOCUMENT), mode: 0o600 });
  entries.push({ path: 'activation-package-manifest.json', bytes: manifestBytes, mode: 0o600 });
  const digestManifest = entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map((item) => `${sha256(item.bytes)}  ${item.path}\n`).join('');
  entries.push({ path: 'manifest.sha256', bytes: Buffer.from(digestManifest), mode: 0o600 });
  require(JSON.stringify(entries.map((item) => item.path).sort()) === JSON.stringify(PACKAGE_FILES));
  return { archive: deterministicTar(entries), fileCount: entries.length };
}

function outputParent(path) {
  let parent = dirname(path);
  while (true) {
    const metadata = lstatSync(parent);
    require(metadata.isDirectory() && !metadata.isSymbolicLink() && !(metadata.mode & 0o022));
    if (parent === dirname(parent)) break;
    parent = dirname(parent);
  }
}

function writeExclusive(path, bytes, created) {
  const fd = openSync(path, 'wx', 0o600);
  const metadata = lstatSync(path);
  created.push({ path, device: metadata.dev, inode: metadata.ino });
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function report(status) {
  const values = { package_status: status, source_only: true, activation_executed: false, deployment_executed: false,
    hostinger_contacted: false, cloudflare_or_dns_changed: false, automatic_failover_enabled: false,
    fencing_executed: false, telephony_contacted: false, credential_values_emitted: false };
  process.stdout.write(`${JSON.stringify(values)}\n`);
}

function main() {
  const created = [];
  try {
    const args = process.argv.slice(2);
    require(args.length === 2 && args[0] === '--output' && args[1]);
    const output = resolve(args[1]);
    const fromRoot = relative(ROOT, output);
    require(fromRoot.startsWith(`..${sep}`) || fromRoot === '..');
    require(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.tar$/u.test(basename(output)));
    outputParent(output);
    const { archive } = assembleActivationPackage();
    writeExclusive(output, archive, created);
    writeExclusive(`${output}.sha256`, `${sha256(archive)}  ${basename(output)}\n`, created);
    report('created');
  } catch {
    for (const item of created.reverse()) {
      try {
        const current = lstatSync(item.path);
        if (current.isFile() && current.dev === item.device && current.ino === item.inode) unlinkSync(item.path);
      } catch { /* Never unlink a prior or replaced file. No diagnostic details are emitted. */ }
    }
    report('blocked');
    process.exitCode = 78;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
