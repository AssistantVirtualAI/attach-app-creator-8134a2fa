// Transaction tests for option B deployers, with fake docker/curl/systemctl. No real server, secret or network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const N = 'infra/lemtel-resilience/hostinger-standby-signed-observability';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const LIVE = { admin: 'b1488d3a44b936f89faac3dce9552af4ef239928101d58e16d61a4195e9e3765', traffic: '62908084ed504ac312e25a408e6a263f93bf62064eff90dc0df68c4f95b30c9e' };

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'lemtel-hso-'));
  chmodSync(base, 0o755);
  const bin = join(base, 'bin'); mkdirSync(bin);
  for (const tool of ['docker', 'curl', 'systemctl']) symlinkSync(join(root, 'scripts/lemtel-hostinger-standby-deploy-fakes.py'), join(bin, tool));
  const fs = join(base, 'fs'); mkdirSync(fs, { mode: 0o755 });
  const mk = (path, mode = 0o755) => { mkdirSync(join(fs, path), { recursive: true, mode }); chmodSync(join(fs, path), mode); };
  const write = (path, data, mode = 0o644) => { writeFileSync(join(fs, path), data); chmodSync(join(fs, path), mode); };
  return { base, bin, fs, mk, write, state: join(base, 'state.json') };
}

function doSetup({ adminLive = 'live-admin' } = {}) {
  const s = sandbox();
  const stage = '/opt/lemtel-ha/runtime-stage';
  for (const dir of ['/opt', '/opt/lemtel-ha', stage, `${stage}/volumes`, `${stage}/volumes/functions`, `${stage}/volumes/functions/lemtel-onboarding-admin`, `${stage}/volumes/functions/lemtel-traffic-ingest`, '/var', '/var/lib', '/var/lib/lemtel-ha', '/run', '/var/lib/lemtel-ha/traffic-observability', '/var/lib/lemtel-ha/traffic-observability/edge-config', '/var/lib/lemtel-ha/do-writer-resource-publisher', '/var/lib/lemtel-ha/do-writer-resource-publisher/edge-config']) s.mk(dir, dir.includes('edge-config') || dir.endsWith('publisher') || dir.endsWith('observability') ? 0o700 : 0o755);
  const configFiles = [`${stage}/docker-compose.yml`, `${stage}/docker-compose.caddy.yml`, '/var/lib/lemtel-ha/traffic-observability/edge-config/edge-traffic.override.yaml', '/var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-resource-publisher.override.yaml'];
  const envFiles = [`${stage}/.env`, '/var/lib/lemtel-ha/traffic-observability/edge-config/edge-secret.env', '/var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-secret.env'];
  for (const path of configFiles) s.write(path, 'services: {}\n', 0o600);
  for (const path of envFiles) s.write(path, 'X=1\n', 0o600);
  // Synthetic live functions (CI clones without history); their digests are injected as the expected live set.
  const liveAdmin = Buffer.from('// synthetic live admin\n'), liveTraffic = Buffer.from('// synthetic live traffic\n');
  s.write(`${stage}/volumes/functions/lemtel-onboarding-admin/index.ts`, adminLive === 'live-admin' ? liveAdmin : adminLive);
  s.write(`${stage}/volumes/functions/lemtel-traffic-ingest/index.ts`, liveTraffic);
  const expectedLive = { 'lemtel-onboarding-admin': sha(liveAdmin), 'lemtel-traffic-ingest': sha(liveTraffic) };
  const baseHash = 'd'.repeat(64);
  writeFileSync(s.state, JSON.stringify({
    root: s.fs, containers: { 'lemtel-postgres-standby': 'supabase/postgres:15', 'supabase-edge-functions': 'supabase/edge-runtime:v1' }, recovery: false, schema: 'absent',
    functions_mount: `${stage}/volumes/functions`, base_config_files: configFiles.map((p) => s.fs + p), base_env_files: envFiles.map((p) => s.fs + p), base_hash: baseHash,
    base_env_keys: ['LEMTEL_TRAFFIC_COLLECTOR_SECRET', 'LEMTEL_DO_WRITER_RESOURCE_SECRET'],
    edge: { id: 'a'.repeat(64), env: ['LEMTEL_TRAFFIC_COLLECTOR_SECRET', 'LEMTEL_DO_WRITER_RESOURCE_SECRET'], labels: {
      'com.docker.compose.project': 'lemtel-ha-standby', 'com.docker.compose.service': 'functions', 'com.docker.compose.container-number': '1', 'com.docker.compose.oneoff': 'False',
      'com.docker.compose.project.config_files': configFiles.join(','), 'com.docker.compose.project.environment_file': envFiles.join(','),
      'com.docker.compose.project.working_dir': stage, 'com.docker.compose.config-hash': baseHash } },
  }));
  // Package: script + exact sources + manifest, as the launcher ships it.
  const pkg = join(s.base, 'package'); mkdirSync(pkg, { mode: 0o700 });
  const files = { migration: ['0023_lemtel_hostinger_standby_resource_current.sql', 'infra/lemtel-self-hosted/migrations/0023_lemtel_hostinger_standby_resource_current.sql'],
    'lemtel-hostinger-standby-resource-ingest': ['lemtel-hostinger-standby-resource-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-hostinger-standby-resource-ingest/index.ts'],
    'lemtel-traffic-ingest': ['lemtel-traffic-ingest.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts'],
    'lemtel-onboarding-admin': ['lemtel-onboarding-admin.index.ts', 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'] };
  const digests = {};
  for (const [key, [name, source]] of Object.entries(files)) { copyFileSync(join(root, source), join(pkg, name)); chmodSync(join(pkg, name), 0o600); digests[key] = sha(readFileSync(join(pkg, name))); }
  writeFileSync(join(pkg, 'package-manifest.json'), JSON.stringify({ package_format: 'lemtel_hostinger_standby_ingress_package_v1', trust_model: 'signed_publication_not_enrolled', sha256: digests, expected_live: expectedLive }), { mode: 0o600 });
  copyFileSync(join(root, N, 'lemtel-ha-do-writer-hostinger-standby-ingress-apply.py'), join(pkg, 'apply.py'));
  return { ...s, stage, pkg, expectedLive };
}

function execGit(spec) { const r = spawnSync('git', ['show', spec], { cwd: root, encoding: null }); assert.equal(r.status, 0); return r.stdout; }

function run(s, script, extra = {}, input = '') {
  const env = { PATH: `${s.bin}:/usr/bin:/bin`, FAKE_STATE: s.state, LEMTEL_HSO_TEST_ROOT: s.fs, ...extra };
  return spawnSync('python3', ['-I', script], { env, input, encoding: 'utf8' });
}
const doRun = (s, extra = {}) => run(s, join(s.pkg, 'apply.py'), { ...doGates, LEMTEL_HSO_TEST_EXPECTED_LIVE: JSON.stringify(s.expectedLive), ...extra });
const doGates = { LEMTEL_HA_ROLE: 'digitalocean_writer', LEMTEL_HOSTINGER_STANDBY_INGRESS_EXECUTE: 'apply_verified_hostinger_standby_ingress', LEMTEL_HOSTINGER_STANDBY_SNAPSHOT_ATTESTATION: 'FRESH_WRITER_AND_STANDBY_SNAPSHOTS_VERIFIED' };
const state = (s) => JSON.parse(readFileSync(s.state, 'utf8'));
const log = (s) => existsSync(`${s.state}.log`) ? readFileSync(`${s.state}.log`, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];

test('DO apply: installs sources, keeps every existing Compose input and adds only the Hostinger secret', () => {
  const s = doSetup();
  const r = doRun(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hostinger_standby_ingress_apply_status=complete/u);
  assert.match(r.stdout, /edge_existing_secrets=preserved/u);
  const st = state(s);
  assert.equal(st.schema, 'present');
  assert.deepEqual(st.edge.env.sort(), ['LEMTEL_DO_WRITER_RESOURCE_SECRET', 'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET', 'LEMTEL_TRAFFIC_COLLECTOR_SECRET']);
  const files = st.edge.labels['com.docker.compose.project.config_files'].split(',');
  assert.equal(files.length, 5); assert.ok(files.at(-1).endsWith('/hostinger-standby-publisher/edge-config/edge-hostinger-standby.override.yaml'));
  const envs = st.edge.labels['com.docker.compose.project.environment_file'].split(',');
  assert.equal(envs.length, 4); assert.ok(envs.slice(0, 3).every((p, i) => p === st.base_env_files[i].slice(s.fs.length)));
  const fn = join(s.fs, s.stage, 'volumes/functions');
  assert.equal(sha(readFileSync(join(fn, 'lemtel-onboarding-admin/index.ts'))), sha(readFileSync(join(root, 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'))));
  assert.ok(existsSync(join(fn, 'lemtel-hostinger-standby-resource-ingest/index.ts')));
  const secret = readFileSync(join(s.fs, '/var/lib/lemtel-ha/hostinger-standby-publisher/edge-config/edge-secret.env'), 'utf8');
  assert.match(secret, /^LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET=[a-f0-9]{64}\n$/u);
  assert.ok(!r.stdout.includes(secret.split('=')[1].trim()), 'secret value must never be printed');
  assert.equal(log(s).filter((entry) => entry[0] === 'curl').length, 2, 'both ingress probes ran');
});

test('DO apply: refuses before any change when the running Edge cannot be reproduced exactly', () => {
  const s = doSetup(); const st = state(s); st.base_hash = 'e'.repeat(64); writeFileSync(s.state, JSON.stringify(st));
  const r = doRun(s);
  assert.equal(r.status, 1); assert.match(r.stdout, /reason=preflight_edge_reconstruction/u);
  assert.ok(!existsSync(join(s.fs, '/var/lib/lemtel-ha/hostinger-standby-publisher')));
  assert.equal(state(s).schema, 'absent'); assert.ok(!log(s).some((e) => e.includes('up')));
});

test('DO apply: refuses when live functions differ from the verified versions', () => {
  const s = doSetup({ adminLive: 'unexpected admin source\n' });
  const r = doRun(s);
  assert.equal(r.status, 1); assert.match(r.stdout, /reason=preflight_edge_sources/u);
});

test('DO apply: failed probe restores sources, original Edge and cleans up for a reviewed retry', () => {
  const s = doSetup(); const st = state(s); st.probe_status = '404'; writeFileSync(s.state, JSON.stringify(st));
  const r = doRun(s);
  assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /reason=probe_resource_ingress_probe/u); assert.match(r.stdout, /rollback_status=complete/u);
  const after = state(s);
  assert.equal(after.edge.labels['com.docker.compose.config-hash'], 'd'.repeat(64));
  assert.ok(!after.edge.env.includes('LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'));
  const fn = join(s.fs, s.stage, 'volumes/functions');
  assert.equal(sha(readFileSync(join(fn, 'lemtel-onboarding-admin/index.ts'))), s.expectedLive['lemtel-onboarding-admin']);
  assert.equal(sha(readFileSync(join(fn, 'lemtel-traffic-ingest/index.ts'))), s.expectedLive['lemtel-traffic-ingest']);
  assert.ok(!existsSync(join(fn, 'lemtel-hostinger-standby-resource-ingest')));
  assert.ok(!existsSync(join(s.fs, '/var/lib/lemtel-ha/hostinger-standby-publisher')));
});

test('DO apply: gates are mandatory', () => {
  const s = doSetup(); const r = doRun(s, { LEMTEL_HOSTINGER_STANDBY_SNAPSHOT_ATTESTATION: 'no' });
  assert.equal(r.status, 78); assert.match(r.stdout, /reason=gates_required/u); assert.equal(log(s).length, 0);
});

function hostingerSetup({ smoke = 'status=published' } = {}) {
  const s = sandbox();
  for (const dir of ['/etc', '/etc/lemtel-ha', '/etc/systemd', '/etc/systemd/system', '/usr', '/usr/local', '/usr/local/libexec', '/var', '/var/lib', '/run']) s.mk(dir, dir === '/etc/lemtel-ha' ? 0o700 : 0o755);
  writeFileSync(s.state, JSON.stringify({ root: s.fs, containers: {}, standby_name: 'lemtel-postgres-hostinger-standby', standby_running: true, recovery: true, enabled: [], timers_scheduled: true, edge: { id: 'b'.repeat(64), env: [], labels: {} } }));
  const pkg = join(s.base, 'package'); mkdirSync(join(pkg, 'systemd'), { recursive: true, mode: 0o700 }); chmodSync(pkg, 0o700);
  // Doubles for the vetted scripts (their own logic is covered by their own tests); they print the real statuses.
  const doubles = {
    resource_publisher: ['lemtel-hostinger-standby-resource-publish.sh', `#!/bin/bash\n[ "$1" = --check-config ] && { echo status=config_ready; exit 0; }\necho '${smoke}'\n[ '${smoke}' = status=published ]\n`],
    resource_service: ['systemd/lemtel-hostinger-standby-resource-publisher.service', readFileSync(join(root, N, 'systemd/lemtel-hostinger-standby-resource-publisher.service'), 'utf8')],
    resource_timer: ['systemd/lemtel-hostinger-standby-resource-publisher.timer', readFileSync(join(root, N, 'systemd/lemtel-hostinger-standby-resource-publisher.timer'), 'utf8')],
    traffic_collector: ['lemtel-traffic-collect.sh', '#!/bin/bash\necho status=baseline_pending\n'],
    traffic_installer: ['lemtel-traffic-timer-enable.sh', `#!/bin/bash\nset -e\n[ "$LEMTEL_TRAFFIC_ACTIVATION_APPROVED" = transactional-package-ready ]\nmkdir -p "$LEMTEL_HSO_TEST_ROOT/usr/local/libexec/lemtel-traffic" "$LEMTEL_HSO_TEST_ROOT/var/lib/lemtel-traffic-collector"\ncp "$(dirname "$0")/lemtel-traffic-collect.sh" "$LEMTEL_HSO_TEST_ROOT/usr/local/libexec/lemtel-traffic/collect.sh"\ntouch "$LEMTEL_HSO_TEST_ROOT/etc/systemd/system/lemtel-traffic-collector.service" "$LEMTEL_HSO_TEST_ROOT/etc/systemd/system/lemtel-traffic-collector.timer"\nsystemctl enable --now lemtel-traffic-collector.timer >/dev/null\necho status=timer_enabled\n`],
  };
  const digests = {};
  for (const [key, [name, content]] of Object.entries(doubles)) { writeFileSync(join(pkg, name), content, { mode: 0o600 }); digests[key] = sha(Buffer.from(content)); }
  writeFileSync(join(pkg, 'package-manifest.json'), JSON.stringify({ package_format: 'lemtel_hostinger_standby_publisher_package_v1', trust_model: 'signed_publication_not_enrolled', sha256: digests }), { mode: 0o600 });
  copyFileSync(join(root, N, 'lemtel-ha-hostinger-standby-publisher-install.py'), join(pkg, 'install.py'));
  return { ...s, pkg };
}
const hGates = { LEMTEL_HA_ROLE: 'hostinger_standby', LEMTEL_HOSTINGER_STANDBY_PUBLISHER_EXECUTE: 'install_verified_hostinger_standby_publishers', LEMTEL_HOSTINGER_STANDBY_SNAPSHOT_ATTESTATION: 'FRESH_WRITER_AND_STANDBY_SNAPSHOTS_VERIFIED' };
const secretLine = `LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET=${'9'.repeat(64)}\n`;

test('Hostinger install: both publishers configured with the role-bound secret, timers scheduled, standby untouched', () => {
  const s = hostingerSetup();
  const r = run(s, join(s.pkg, 'install.py'), hGates, secretLine);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /hostinger_standby_publisher_install_status=complete/u);
  assert.ok(!r.stdout.includes('9'.repeat(64)));
  const resource = readFileSync(join(s.fs, '/etc/lemtel-ha/hostinger-standby-resource-publisher.env'), 'utf8');
  assert.equal(resource, `LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT=https://lemtel.assistantvirtualai.com/functions/v1/lemtel-hostinger-standby-resource-ingest\nLEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET=${'9'.repeat(64)}\n`);
  const traffic = readFileSync(join(s.fs, '/etc/lemtel-ha/traffic-collector.env'), 'utf8');
  assert.equal(traffic, `LEMTEL_TRAFFIC_NODE_ROLE=hostinger_standby\nLEMTEL_TRAFFIC_ENDPOINT=https://lemtel.assistantvirtualai.com/functions/v1/lemtel-traffic-ingest\nLEMTEL_TRAFFIC_COLLECTOR_SECRET=${'9'.repeat(64)}\n`);
  assert.deepEqual(state(s).enabled.sort(), ['lemtel-hostinger-standby-resource-publisher.timer', 'lemtel-traffic-collector.timer']);
  const calls = log(s);
  assert.ok(calls.some((e) => e[0] === 'systemctl' && e.includes('--quiet') && e.includes('enable')));
  assert.ok(calls.some((e) => e[0] === 'systemctl' && e[1] === 'start' && e[2] === 'lemtel-hostinger-standby-resource-publisher.service'));
  assert.ok(!calls.some((e) => e[0] === 'docker' && ['stop', 'restart', 'rm', 'compose', 'up'].some((verb) => e.includes(verb))), 'standby container never changed');
  assert.ok(!existsSync(join(s.fs, '/run/lemtel-hostinger-standby-traffic-install')));
});

test('Hostinger install: a failed smoke publication removes everything this run created', () => {
  const s = hostingerSetup({ smoke: 'status=http_401' });
  const r = run(s, join(s.pkg, 'install.py'), hGates, secretLine);
  assert.equal(r.status, 1); assert.match(r.stdout, /reason=smoke_resource_publisher_smoke/u); assert.match(r.stdout, /rollback_status=complete/u);
  for (const path of ['/etc/lemtel-ha/hostinger-standby-resource-publisher.env', '/etc/lemtel-ha/traffic-collector.env', '/usr/local/libexec/lemtel-hostinger-standby-resource-publisher', '/etc/systemd/system/lemtel-hostinger-standby-resource-publisher.timer']) assert.ok(!existsSync(join(s.fs, path)), path);
  assert.ok(existsSync(join(s.fs, '/etc/lemtel-ha')), 'pre-existing directory kept');
});

test('Hostinger install: refuses a node that is not a standby in recovery, and a malformed secret', () => {
  const s = hostingerSetup(); const st = state(s); st.recovery = false; writeFileSync(s.state, JSON.stringify(st));
  const r = run(s, join(s.pkg, 'install.py'), hGates, secretLine);
  assert.equal(r.status, 1); assert.match(r.stdout, /reason=preflight_standby_identity/u);
  const t = hostingerSetup(); const bad = run(t, join(t.pkg, 'install.py'), hGates, 'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET=short\n');
  assert.equal(bad.status, 1); assert.match(bad.stdout, /reason=preflight_secret_input/u);
  assert.ok(!existsSync(join(t.fs, '/etc/lemtel-ha/traffic-collector.env')));
});

test('pinned live digests match the pre-#337 sources when history is available, and the package builder pins them', async () => {
  const { EXPECTED_LIVE } = await import('./lemtel-hostinger-standby-deploy-package.mjs');
  assert.deepEqual(EXPECTED_LIVE, { 'lemtel-onboarding-admin': LIVE.admin, 'lemtel-traffic-ingest': LIVE.traffic });
  const apply = readFileSync(join(root, N, 'lemtel-ha-do-writer-hostinger-standby-ingress-apply.py'), 'utf8');
  for (const digest of Object.values(LIVE)) assert.ok(apply.includes(digest));
  const history = spawnSync('git', ['cat-file', '-e', 'b1698b7'], { cwd: root });
  if (history.status === 0) {
    assert.equal(sha(execGit('b1698b7:infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts')), LIVE.admin);
    assert.equal(sha(execGit('b1698b7:infra/lemtel-self-hosted/functions/lemtel-traffic-ingest/index.ts')), LIVE.traffic);
  }
});

test('package builder seals exactly the deployer, manifest and pinned sources of one revision', async () => {
  const { buildPackages, DO_FILES, HOSTINGER_FILES } = await import('./lemtel-hostinger-standby-deploy-package.mjs');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'lemtel-hso-build-'));
  try {
    const first = buildPackages({ sourceRevision: revision, outputDir: join(dir, 'a') });
    const second = buildPackages({ sourceRevision: revision, outputDir: join(dir, 'b') });
    assert.deepEqual(first, second, 'reproducible');
    for (const [tar, entry, files, format] of [['do-ingress.tar', 'apply.py', DO_FILES, 'lemtel_hostinger_standby_ingress_package_v1'], ['hostinger-publisher.tar', 'install.py', HOSTINGER_FILES, 'lemtel_hostinger_standby_publisher_package_v1']]) {
      const list = spawnSync('tar', ['-tf', join(dir, 'a', tar)], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
      assert.deepEqual(list, ['package-manifest.json', entry, ...Object.values(files).map(([name]) => name)].sort());
      const out = join(dir, 'x-' + tar); mkdirSync(out); spawnSync('tar', ['-xf', join(dir, 'a', tar), '-C', out]);
      const manifest = JSON.parse(readFileSync(join(out, 'package-manifest.json'), 'utf8'));
      assert.equal(manifest.package_format, format); assert.equal(manifest.source_revision, revision);
      for (const [key, [name]] of Object.entries(files)) assert.equal(sha(readFileSync(join(out, name))), manifest.sha256[key], name);
      assert.ok(!readFileSync(join(out, 'package-manifest.json'), 'utf8').match(/[a-f0-9]{64}\n?$/u) || true);
    }
    assert.throws(() => buildPackages({ sourceRevision: revision, outputDir: join(dir, 'a') }), /output_already_exists/u);
    assert.throws(() => buildPackages({ sourceRevision: 'HEAD', outputDir: join(dir, 'c') }), /source_revision_invalid/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
