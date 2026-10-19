// Offline test of the DO deployment of the FusionPBX connection + failover-status release (fake docker/openssl).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SCRIPT = resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-telephony-connection-deploy.sh');
const reason = (r) => (r.stderr.match(/reason=([a-z0-9_]+)/u) || [])[1];

const CADDY_OK = 'site {\n  # LEMTEL_OPERATIONS_PORTAL_V1\n  handle @lemtel_operations_portal {\n    uri strip_prefix /lemtel-portal\n    root * /etc/caddy/lemtel-portal\n    try_files {path} /lemtel-portal.html\n    file_server\n  }\n}\nprobe {\n  # LEMTEL_OPERATIONS_PORTAL_V1\n}\n';
function world({ caddyfile = CADDY_OK, privateCompose = 'services:\n  kong:\n    environment:\n      KONG_X: y\n', fenced = false, recovery = 'false', composeBreaks = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-tc-'));
  const bin = join(root, 'bin'), fake = join(root, 'fake'), dir = join(root, 'srv/supabase'), fns = join(root, 'srv/supabase/volumes/functions'), caddy = join(root, 'srv/supabase/volumes/proxy/caddy');
  for (const d of [bin, fake, join(fns, '_shared'), join(fns, 'lemtel-onboarding-admin'), join(caddy, 'lemtel-portal/assets'), join(root, 'run'), join(root, 'var/lib/lemtel-ha')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(dir, '.env'), 'POSTGRES_PASSWORD=x\n');
  for (const f of ['docker-compose.yml', 'docker-compose.caddy.yml', 'docker-compose.lemtel-db-init.yml']) writeFileSync(join(dir, f), 'services: {}\n');
  writeFileSync(join(dir, 'docker-compose.lemtel-private.yml'), privateCompose);
  writeFileSync(join(caddy, 'Caddyfile'), caddyfile);
  writeFileSync(join(caddy, 'lemtel-portal/lemtel-portal.html'), 'OLD');
  if (fenced) writeFileSync(join(root, 'fence-status'), 'boot_fence=fenced\n');
  const bundle = join(root, 'bundle'); mkdirSync(bundle);
  const portalSrc = join(root, 'portal-src'); mkdirSync(join(portalSrc, 'assets'), { recursive: true });
  writeFileSync(join(portalSrc, 'lemtel-portal.html'), 'NEW'); writeFileSync(join(portalSrc, 'assets/a.js'), 'js');
  execFileSync('tar', ['-C', portalSrc, '-cf', join(bundle, 'portal.tar'), '.']);
  const files = { '0024_lemtel_pbx_connection.sql': 'SELECT 1;', 'lemtelPbxConnection.ts': '//shared', 'lemtel-pbx-connection-admin.index.ts': '//admin',
    'lemtel-softphone-provisioning.index.ts': '//prov', 'lemtel-failover-status.index.ts': '//status' };
  for (const [n, c] of Object.entries(files)) writeFileSync(join(bundle, n), c);
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  writeFileSync(join(bundle, 'manifest.sha256'), [...Object.keys(files), 'portal.tar'].map((n) => `${sha(join(bundle, n))}  ${n}`).join('\n') + '\n');
  const docker = `#!/bin/bash
F="${fake}"; echo "docker $*" >> "$F/log"
case "$1" in
  ps) echo "supabase-db|supabase/postgres:17.6.1.136"; echo "supabase-kong|kong:2" ;;
  inspect)
    case "$*" in
      *State.Running*) echo true ;;
      *working_dir*) echo /srv/supabase ;;
      *compose.project\\"*|*'compose.project"'*) echo supabase ;;
      *compose.service*) echo functions ;;
      *home/deno/functions*) echo /srv/supabase/volumes/functions ;;
      *etc/caddy*) echo /srv/supabase/volumes/proxy/caddy ;;
      *Config.Env*) if [ -f "$F/recreated" ]; then printf 'SUPABASE_URL=x\\nLEMTEL_PBX_SECRET_ENCRYPTION_KEY=k\\nLEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY=disabled\\nLEMTEL_ARBITER_STATUS_URL=u\\n'; else echo SUPABASE_URL=x; fi ;;
      *) echo supabase ;;
    esac ;;
  exec) if [[ "$*" == *rolsuper* ]]; then echo t; exit 0; fi
    sql="$(cat)"; echo "sql $sql" >> "$F/log"
    case "$sql" in *pg_is_in_recovery*) echo ${recovery} ;; *"tablename IN"*) echo 4 ;; *"LIKE 'lemtel_pbx_"*) echo 0 ;; esac ;;
  compose) case "$*" in *"config --services"*) ${composeBreaks ? `if grep -q LEMTEL_PBX "$LEMTEL_TC_TEST_ROOT/srv/supabase/docker-compose.lemtel-private.yml"; then exit 1; fi;` : ''} echo functions; echo kong ;; *"up -d --no-deps functions"*) touch "$F/recreated" ;; esac ;;
esac
`;
  writeFileSync(join(bin, 'docker'), docker); chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(bin, 'openssl'), '#!/bin/bash\nhead -c 32 /dev/urandom | base64\n'); chmodSync(join(bin, 'openssl'), 0o755);
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n'); chmodSync(join(bin, 'sleep'), 0o755);
  const run = (mode, extra = {}) => spawnSync('bash', [SCRIPT, mode], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, LEMTEL_TC_TEST_ROOT: root, LEMTEL_HA_ROLE: 'digitalocean_writer', LEMTEL_TC_BUNDLE: bundle, ...extra } });
  return { root, dir, fns, caddy, bundle, run, log: () => readFileSync(join(fake, 'log'), 'utf8') };
}
const GO = { LEMTEL_TC_EXECUTE: 'deploy_telephony_connection_and_portal' };

test('check is read-only and reports the layout', () => {
  const w = world();
  const r = w.run('check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /compose_project=supabase\nfunctions_service=functions/u);
  assert.match(r.stdout, /changes_made=false/u);
  assert.equal(readFileSync(join(w.dir, '.env'), 'utf8'), 'POSTGRES_PASSWORD=x\n');
  assert.doesNotMatch(w.log(), /up -d --no-deps/u);
});

test('deploy: schema, generated key (never printed), compose wiring, functions, portal swap', () => {
  const w = world();
  const r = w.run('deploy', GO);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const env = readFileSync(join(w.dir, '.env'), 'utf8');
  const key = env.match(/^LEMTEL_PBX_SECRET_ENCRYPTION_KEY=(.+)$/mu)[1];
  assert.equal(Buffer.from(key, 'base64').length, 32);
  assert.ok(!r.stdout.includes(key) && !r.stderr.includes(key), 'the key is never printed');
  assert.match(env, /^LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY=disabled$/mu);
  const compose = readFileSync(join(w.dir, 'docker-compose.lemtel-private.yml'), 'utf8');
  assert.match(compose, /^  kong:\n    environment:\n      KONG_X: y\n  functions:\n    environment:\n      LEMTEL_PBX_SECRET_ENCRYPTION_KEY: \$\{LEMTEL_PBX_SECRET_ENCRYPTION_KEY:-\}/mu);
  assert.equal(readFileSync(join(w.fns, 'lemtel-pbx-connection-admin/index.ts'), 'utf8'), '//admin');
  assert.equal(readFileSync(join(w.fns, '_shared/lemtelPbxConnection.ts'), 'utf8'), '//shared');
  assert.equal(readFileSync(join(w.caddy, 'lemtel-portal/lemtel-portal.html'), 'utf8'), 'NEW');
  assert.match(w.log(), /up -d --no-deps functions/u);
  assert.match(r.stdout, /credential_delivery=disabled/u);
  // Idempotent: second run keeps the same key and adds nothing.
  const again = w.run('deploy', GO);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(w.dir, '.env'), 'utf8').match(/^LEMTEL_PBX_SECRET_ENCRYPTION_KEY=(.+)$/mu)[1], key);
  assert.match(again.stdout, /function_environment=unchanged\ncompose_override=unchanged/u);
});

test('existing functions service: map and list environment styles are extended, not duplicated', () => {
  const map = world({ privateCompose: 'services:\n  functions:\n    image: x\n    environment:\n      A: b\n      LEMTEL_PUBLIC_SITE_URL: keep\n  kong:\n    image: k\n' });
  assert.equal(map.run('deploy', GO).status, 0);
  const m = readFileSync(join(map.dir, 'docker-compose.lemtel-private.yml'), 'utf8');
  assert.match(m, /      A: b\n      LEMTEL_PUBLIC_SITE_URL: keep\n      LEMTEL_PBX_SECRET_ENCRYPTION_KEY: \$\{LEMTEL_PBX_SECRET_ENCRYPTION_KEY:-\}/u);
  assert.equal((m.match(/LEMTEL_PUBLIC_SITE_URL/gu) || []).length, 1);
  assert.match(m, /\n  kong:\n    image: k\n/u);
  const list = world({ privateCompose: 'services:\n  functions:\n    environment:\n      - A=b\n' });
  assert.equal(list.run('deploy', GO).status, 0);
  assert.match(readFileSync(join(list.dir, 'docker-compose.lemtel-private.yml'), 'utf8'), /      - A=b\n      - LEMTEL_PBX_SECRET_ENCRYPTION_KEY=\$\{LEMTEL_PBX_SECRET_ENCRYPTION_KEY:-\}/u);
});

test('refusals: fenced DO, standby database, missing token, tampered bundle — nothing changed', () => {
  assert.equal(reason(world({ fenced: true }).run('deploy', GO)), 'do_is_fenced_not_the_writer');
  assert.equal(reason(world({ recovery: 'true' }).run('deploy', GO)), 'writer_not_verified');
  const w = world();
  assert.equal(reason(w.run('deploy')), 'execution_token_required');
  writeFileSync(join(w.bundle, 'lemtel-failover-status.index.ts'), '//tampered');
  assert.equal(reason(w.run('deploy', GO)), 'bundle_digest_mismatch_lemtel_failover_status');
  assert.equal(readFileSync(join(w.dir, '.env'), 'utf8'), 'POSTGRES_PASSWORD=x\n');
});

test('a compose file broken by the change is rolled back (env, override, functions) before anything restarts', () => {
  const w = world({ composeBreaks: true });
  const r = w.run('deploy', GO);
  assert.equal(reason(r), 'compose_config_invalid_after_change');
  assert.match(r.stderr, /rolled_back=true/u);
  assert.equal(readFileSync(join(w.dir, '.env'), 'utf8'), 'POSTGRES_PASSWORD=x\n');
  assert.doesNotMatch(readFileSync(join(w.dir, 'docker-compose.lemtel-private.yml'), 'utf8'), /LEMTEL_PBX/u);
  assert.equal(existsSync(join(w.fns, 'lemtel-pbx-connection-admin/index.ts')), false);
  assert.equal(readFileSync(join(w.caddy, 'lemtel-portal/lemtel-portal.html'), 'utf8'), 'OLD');
});

test('portal route: repeated ownership comments are fine, a missing or duplicated handler is refused', () => {
  assert.equal(world().run('check').status, 0, 'production layout: the comment appears twice');
  assert.equal(reason(world({ caddyfile: '# LEMTEL_OPERATIONS_PORTAL_V1\n' }).run('check')), 'portal_route_missing_or_ambiguous');
  const twice = CADDY_OK.replace('probe {', 'probe {\n  handle @lemtel_operations_portal {\n    uri strip_prefix /lemtel-portal\n    root * /etc/caddy/lemtel-portal\n    try_files {path} /lemtel-portal.html\n    file_server\n  }');
  assert.equal(reason(world({ caddyfile: twice }).run('check')), 'portal_route_missing_or_ambiguous');
});
