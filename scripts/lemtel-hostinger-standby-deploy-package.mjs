// Builds the two reproducible, offline-verifiable packages for option B from ONE detached Git revision:
//   do-ingress.tar          -> run on the DO writer (migration 0023, functions, role-bound Edge secret)
//   hostinger-publisher.tar -> run on the Hostinger standby (traffic collector + resource publisher)
// Usage: node scripts/lemtel-hostinger-standby-deploy-package.mjs --source-revision <40-hex> --output-dir <dir>
// It deploys nothing, contains no secret and reads sources only from the Git object, never the worktree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const N = 'infra/lemtel-resilience/hostinger-standby-signed-observability';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (args, options = {}) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, ...options });
export const EXPECTED_LIVE = {
  'lemtel-onboarding-admin': 'b1488d3a44b936f89faac3dce9552af4ef239928101d58e16d61a4195e9e3765',
  'lemtel-traffic-ingest': '62908084ed504ac312e25a408e6a263f93bf62064eff90dc0df68c4f95b30c9e',
};
export const DO_FILES = {
  migration: ['0023_lemtel_hostinger_standby_resource_current.sql', 'infra/lemtel-self-hosted/migrations/0023_lemtel_hostinger_standby_resource_current.sql'],
  'lemtel-hostinger-standby-resource-ingest': ['lemtel-hostinger-standby-resource-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-hostinger-standby-resource-ingest/index.ts'],
  'lemtel-traffic-ingest': ['lemtel-traffic-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts'],
  'lemtel-onboarding-admin': ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'],
};
export const HOSTINGER_FILES = {
  resource_publisher: ['lemtel-hostinger-standby-resource-publish.sh', `${N}/lemtel-hostinger-standby-resource-publish.sh`],
  resource_service: ['systemd/lemtel-hostinger-standby-resource-publisher.service', `${N}/systemd/lemtel-hostinger-standby-resource-publisher.service`],
  resource_timer: ['systemd/lemtel-hostinger-standby-resource-publisher.timer', `${N}/systemd/lemtel-hostinger-standby-resource-publisher.timer`],
  traffic_collector: ['lemtel-traffic-collect.sh', 'infra/lemtel-resilience/traffic-observability/lemtel-traffic-collect.sh'],
  traffic_installer: ['lemtel-traffic-timer-enable.sh', 'infra/lemtel-resilience/traffic-observability/lemtel-traffic-timer-enable.sh'],
};

function build(revision, output, entrypoint, entrySource, files, manifestExtra) {
  const stage = mkdtempSync(join(tmpdir(), 'lemtel-hso-package-'));
  try {
    const digests = {};
    const write = (name, data) => { mkdirSync(dirname(join(stage, name)), { recursive: true }); writeFileSync(join(stage, name), data, { mode: 0o600 }); };
    write(entrypoint, git(['show', `${revision}:${entrySource}`]));
    for (const [key, [name, source]] of Object.entries(files)) { const data = git(['show', `${revision}:${source}`]); write(name, data); digests[key] = sha(data); }
    write('package-manifest.json', `${JSON.stringify({ source_revision: revision, trust_model: 'signed_publication_not_enrolled', sha256: digests, ...manifestExtra }, null, 2)}\n`);
    const names = ['package-manifest.json', entrypoint, ...Object.values(files).map(([name]) => name)].sort();
    execFileSync('tar', ['--format=ustar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rw,go=', '-cf', output, '-C', stage, ...names]);
    return sha(execFileSync('cat', [output], { maxBuffer: 16 * 1024 * 1024 }));
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function buildPackages({ sourceRevision, outputDir }) {
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new Error('source_revision_invalid');
  if (git(['cat-file', '-t', sourceRevision], { encoding: 'utf8' }).trim() !== 'commit') throw new Error('source_revision_missing');
  mkdirSync(outputDir, { recursive: true });
  const doTar = join(outputDir, 'do-ingress.tar'), hTar = join(outputDir, 'hostinger-publisher.tar');
  if (existsSync(doTar) || existsSync(hTar)) throw new Error('output_already_exists');
  const doSha = build(sourceRevision, doTar, 'apply.py', `${N}/lemtel-ha-do-writer-hostinger-standby-ingress-apply.py`, DO_FILES,
    { package_format: 'lemtel_hostinger_standby_ingress_package_v1', expected_live: EXPECTED_LIVE });
  const hSha = build(sourceRevision, hTar, 'install.py', `${N}/lemtel-ha-hostinger-standby-publisher-install.py`, HOSTINGER_FILES,
    { package_format: 'lemtel_hostinger_standby_publisher_package_v1' });
  return { doSha, hSha };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    const result = buildPackages({ sourceRevision: at('--source-revision') ?? '', outputDir: at('--output-dir') ?? '' });
    process.stdout.write(`${JSON.stringify({ package_status: 'created', do_ingress_sha256: result.doSha, hostinger_publisher_sha256: result.hSha, deployment_executed: false })}\n`);
  } catch (error) { process.stderr.write(`package_status=failed\nreason=${error.message}\n`); process.exitCode = 64; }
}
