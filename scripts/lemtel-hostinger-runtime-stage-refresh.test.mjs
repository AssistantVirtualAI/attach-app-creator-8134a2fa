import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Offline: real age + tar, fake docker. Requires `age` on PATH (installed in CI).
const script = resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-runtime-stage-refresh.sh');
const CADDY = '{$PROXY_DOMAIN}, lemtel.assistantvirtualai.com {\n  @lemtel_load_balancer_ready path /lemtel-lb-ready\n  handle {\n    reverse_proxy studio:3000\n  }\n}\n';

function fixture({ extraPath, dropPooler = false, recovery = 't' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-hsr-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/bin/bash
case "$*" in
  "ps -a --format {{.Names}}|{{.Image}}") echo "lemtel-postgres-hostinger-standby|supabase/postgres:17.6.1.136";;
  *pg_is_in_recovery*) echo ${recovery};;
  "ps -q --filter label=com.docker.compose.project=lemtel-ha-hostinger-promoted") ;;
  *"config --services"*) printf '%s\\n' api-gw auth caddy db functions imgproxy meta realtime rest storage studio supavisor;;
  *) exit 1;;
esac\n`); chmodSync(join(bin, 'docker'), 0o755);
  for (const dir of ['opt/lemtel-ha/runtime-stage/volumes/pooler', 'run', 'var/lib/lemtel-ha']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'opt/lemtel-ha/runtime-stage/old-marker'), 'old');
  writeFileSync(join(root, 'opt/lemtel-ha/runtime-stage/volumes/pooler/pooler.exs'), 'pooler-old');
  const src = join(root, 'src');
  for (const dir of ['volumes/functions/main', 'volumes/proxy/caddy/lemtel-portal', 'volumes/api/envoy', 'volumes/pooler']) mkdirSync(join(src, dir), { recursive: true });
  writeFileSync(join(src, '.env'), 'PROXY_DOMAIN=example\n');
  for (const f of ['docker-compose.yml', 'docker-compose.caddy.yml', 'docker-compose.lemtel-private.yml', 'docker-compose.lemtel-db-init.yml']) writeFileSync(join(src, f), 'services: {}\n');
  writeFileSync(join(src, 'volumes/functions/main/index.ts'), 'export {}\n');
  writeFileSync(join(src, 'volumes/proxy/caddy/Caddyfile'), CADDY);
  writeFileSync(join(src, 'volumes/proxy/caddy/lemtel-lb-ready.json'), '{"status":"healthy"}');
  writeFileSync(join(src, 'volumes/proxy/caddy/lemtel-portal/lemtel-portal.html'), '<html></html>');
  for (const f of ['envoy.yaml', 'cds.yaml', 'lds.template.yaml', 'docker-entrypoint.sh']) writeFileSync(join(src, 'volumes/api/envoy', f), 'x');
  if (!dropPooler) writeFileSync(join(src, 'volumes/pooler/pooler.exs'), 'pooler-new');
  if (extraPath) { mkdirSync(join(src, 'volumes/db'), { recursive: true }); writeFileSync(join(src, 'volumes/db/secret'), 'x'); }
  const paths = ['.env', 'docker-compose.yml', 'docker-compose.caddy.yml', 'docker-compose.lemtel-private.yml', 'docker-compose.lemtel-db-init.yml',
    'volumes/functions', 'volumes/proxy/caddy', 'volumes/api/envoy/envoy.yaml', 'volumes/api/envoy/cds.yaml', 'volumes/api/envoy/lds.template.yaml',
    'volumes/api/envoy/docker-entrypoint.sh', ...(dropPooler ? [] : ['volumes/pooler/pooler.exs']), ...(extraPath ? ['volumes/db'] : [])];
  execFileSync('tar', ['-cf', join(root, 'runtime.tar'), '-C', src, ...paths]);
  execFileSync('age-keygen', ['-o', join(root, 'identity.txt')], { stdio: 'ignore' });
  const recipient = execFileSync('age-keygen', ['-y', join(root, 'identity.txt')]).toString().trim();
  execFileSync('age', ['-r', recipient, '-o', join(root, 'runtime.age'), join(root, 'runtime.tar')]);
  const sha = createHash('sha256').update(readFileSync(join(root, 'runtime.age'))).digest('hex');
  const run = (overrides = {}) => spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`,
    LEMTEL_HA_EXECUTE: 'refresh_hostinger_runtime_stage', LEMTEL_HA_ROLE: 'hostinger_standby', LEMTEL_HSR_TEST_ROOT: root,
    LEMTEL_HSR_AGE_IDENTITY: join(root, 'identity.txt'), LEMTEL_HA_RUNTIME_ENVELOPE: join(root, 'runtime.age'),
    LEMTEL_HA_RUNTIME_ENVELOPE_SHA256: sha, ...overrides } });
  return { root, sha, run, stage: join(root, 'opt/lemtel-ha/runtime-stage') };
}

test('refreshes the stage from the DO envelope: no marker, TLS internal, backup kept, artifact recorded', () => {
  const f = fixture();
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hostinger_runtime_stage_refresh_status=complete/u);
  assert.ok(!existsSync(join(f.stage, 'volumes/proxy/caddy/lemtel-lb-ready.json')), 'never stage a readiness marker');
  const caddy = readFileSync(join(f.stage, 'volumes/proxy/caddy/Caddyfile'), 'utf8');
  assert.match(caddy, /lemtel\.assistantvirtualai\.com \{\n  tls internal\n/u);
  assert.equal(readFileSync(join(f.stage, 'volumes/pooler/pooler.exs'), 'utf8'), 'pooler-new');
  assert.ok(existsSync(join(f.stage, 'volumes/functions/main/index.ts')));
  const backups = readdirSync(join(f.root, 'var/lib/lemtel-ha/runtime-stage-backups'));
  assert.equal(backups.length, 1);
  assert.ok(existsSync(join(f.root, 'var/lib/lemtel-ha/runtime-stage-backups', backups[0], 'old-marker')));
  assert.equal(readFileSync(join(f.root, 'var/lib/lemtel-ha/artifacts/hostinger-received/current.sha256'), 'utf8').trim(), f.sha);
});

test('keeps the current pooler.exs when an older envelope does not carry it', () => {
  const f = fixture({ dropPooler: true });
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(join(f.stage, 'volumes/pooler/pooler.exs'), 'utf8'), 'pooler-old');
});

test('refuses unexpected envelope content, a wrong digest, or a standby out of recovery, and leaves the stage untouched', () => {
  for (const [options, overrides, reason] of [[{ extraPath: true }, {}, 'envelope_unexpected_path'],
    [{}, { LEMTEL_HA_RUNTIME_ENVELOPE_SHA256: 'c'.repeat(64) }, 'envelope_sha256_mismatch'], [{ recovery: 'f' }, {}, 'standby_not_in_recovery']]) {
    const f = fixture(options);
    const r = f.run(overrides);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, new RegExp(`reason=${reason}`, 'u'));
    assert.ok(existsSync(join(f.stage, 'old-marker')), 'previous stage still in place');
  }
});
