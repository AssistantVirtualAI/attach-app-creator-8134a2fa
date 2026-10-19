import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Offline: fake docker and curl on PATH; the Caddyfile lives in a temporary "bind mount".
const script = resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-origin-probe-site.sh');
const PUBLIC = 'lemtel.assistantvirtualai.com {\n  # LEMTEL_LOAD_BALANCER_READY_V1\n  @lemtel_load_balancer_ready path /lemtel-lb-ready\n' +
  '  handle @lemtel_load_balancer_ready {\n    root * /etc/caddy\n    rewrite * /lemtel-lb-ready.json\n    file_server\n  }\n}\n';

function world({ caddy = PUBLIC, adapt = 0, marker = '200', other = '404' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-op-')); const bin = join(root, 'bin'); mkdirSync(bin);
  const mount = join(root, 'caddy'); mkdirSync(mount);
  writeFileSync(join(mount, 'Caddyfile'), caddy);
  writeFileSync(join(bin, 'docker'), `#!/bin/bash
echo "$*" >> ${root}/docker.log
case "$1" in
  inspect) if [[ "$*" == *State.Running* ]]; then echo true; elif [[ "$*" == *Mounts* ]]; then echo ${mount}; fi;;
  exec) if [[ "$*" == *adapt* ]]; then cat > /dev/null; exit ${adapt}; fi;;
esac\n`);
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
echo "$*" >> ${root}/curl.log
if [[ "$*" == *lemtel-lb-ready* ]]; then printf '%s' '${marker}'; else printf '%s' '${other}'; fi\n`);
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\n:\n');
  for (const f of ['docker', 'curl', 'sleep']) chmodSync(join(bin, f), 0o755);
  const run = (mode) => spawnSync('bash', [script, mode], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, LEMTEL_OPS_TEST_ROOT: root } });
  const read = (name) => existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '';
  return { root, run, caddyfile: () => readFileSync(join(mount, 'Caddyfile'), 'utf8'), docker: () => read('docker.log'), curl: () => read('curl.log') };
}

test('installs the DO-only probe site once, reloads Caddy, and attests marker 200 / other paths 404 through SNI', () => {
  const w = world();
  const r = w.run('install');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /probe_block_before=absent\nprobe_marker_http=200\nprobe_other_path_http=404/u);
  const caddy = w.caddyfile();
  assert.ok(caddy.startsWith(PUBLIC), 'the public site is untouched');
  assert.match(caddy, /# LEMTEL_DO_ORIGIN_PROBE_V1\nlemtel-do-l7\.assistantvirtualai\.com \{\n  tls internal\n/u);
  assert.match(caddy, /rewrite \* \/lemtel-lb-ready\.json/u);
  assert.match(caddy, /handle \{\n    respond 404\n  \}\n\}\n# LEMTEL_DO_ORIGIN_PROBE_V1_END\n$/u);
  assert.match(w.docker(), /caddy reload/u);
  assert.match(w.curl(), /--resolve lemtel-do-l7\.assistantvirtualai\.com:443:127\.0\.0\.1 https:\/\/lemtel-do-l7\.assistantvirtualai\.com\/lemtel-lb-ready/u);
  const again = w.run('install');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /probe_block_before=current/u);
  assert.equal(w.caddyfile(), caddy, 'idempotent: no second block');
  assert.equal((w.docker().match(/caddy reload/gu) || []).length, 1, 'no reload when already current');
});

test('a drifted block is replaced in place; status reports without changing anything', () => {
  const w = world({ caddy: `${PUBLIC}\n# LEMTEL_DO_ORIGIN_PROBE_V1\nlemtel-do-l7.assistantvirtualai.com {\n  respond 200\n}\n# LEMTEL_DO_ORIGIN_PROBE_V1_END\n` });
  const status = w.run('status');
  assert.match(status.stdout, /probe_block=drifted/u);
  assert.equal(w.docker().includes('reload'), false);
  const r = w.run('install');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((w.caddyfile().match(/LEMTEL_DO_ORIGIN_PROBE_V1\n/gu) || []).length, 1);
  assert.doesNotMatch(w.caddyfile(), /respond 200/u);
});

test('refuses without the public route, with an invalid candidate, or when the probe does not serve the marker (rolled back)', () => {
  const missing = world({ caddy: 'lemtel.assistantvirtualai.com {\n}\n' });
  assert.match(missing.run('install').stderr, /reason=public_l7_route_missing/u);
  const invalid = world({ adapt: 1 });
  assert.match(invalid.run('install').stderr, /reason=caddy_candidate_invalid/u);
  assert.equal(invalid.caddyfile(), PUBLIC, 'nothing replaced');
  const unserved = world({ marker: '502' });
  const r = unserved.run('install');
  assert.match(r.stderr, /reason=probe_marker_not_served/u);
  assert.equal(unserved.caddyfile(), PUBLIC, 'rolled back to the previous Caddyfile');
  assert.equal((unserved.docker().match(/caddy reload/gu) || []).length, 2, 'reload, then rollback reload');
});
