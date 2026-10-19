// Offline test of the Edge Functions Compose-chain repair on the DO writer (fake docker).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-edge-runtime-repair.sh');
const reason = (r) => (r.stderr.match(/reason=([a-z0-9_]+)/u) || [])[1];

function world({ composeInvalid = false, upLosesTraffic = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-er-'));
  const bin = join(root, 'bin'), fake = join(root, 'fake');
  const files = {
    'srv/supabase/.env': 'LEMTEL_PBX_SECRET_ENCRYPTION_KEY=k\n', 'srv/supabase/docker-compose.yml': '', 'srv/supabase/docker-compose.email.yml': '',
    'srv/supabase/docker-compose.lemtel-private.yml': '',
    'var/lib/lemtel-ha/transactional-email/runtime-config/compose.lemtel-transactional-email.yml': '',
    'var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-secret.env': '', 'var/lib/lemtel-ha/do-writer-resource-publisher/edge-config/edge-resource-publisher.override.yaml': '',
    'var/lib/lemtel-ha/traffic-observability/edge-config/edge-secret.env': '', 'var/lib/lemtel-ha/traffic-observability/edge-config/edge-traffic.override.yaml': '',
  };
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  mkdirSync(bin); mkdirSync(fake);
  const full = 'SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY LEMTEL_WELCOME_FROM LEMTEL_DO_WRITER_RESOURCE_SECRET LEMTEL_TRAFFIC_COLLECTOR_SECRET LEMTEL_PBX_SECRET_ENCRYPTION_KEY';
  const after = upLosesTraffic ? full.replace(' LEMTEL_TRAFFIC_COLLECTOR_SECRET', '') : full;
  writeFileSync(join(bin, 'docker'), `#!/bin/bash
F="${fake}"; echo "docker $*" >> "$F/log"
case "$1" in
  inspect) c="\${@: -1}"
    case "$*" in
      *State.Running*) echo true ;;
      *Config.Env*) if [ -f "$F/up" ]; then for n in ${after}; do echo "$n=v"; done; else echo SUPABASE_URL=v; echo SUPABASE_SERVICE_ROLE_KEY=v; echo LEMTEL_PBX_SECRET_ENCRYPTION_KEY=v; fi ;;
      *config_files*) if [ "$c" = supabase-rest ]; then echo /srv/supabase/docker-compose.yml,/srv/supabase/docker-compose.email.yml; else echo /srv/supabase/docker-compose.yml; fi ;;
      *environment_file*) echo /srv/supabase/.env ;;
      *working_dir*) echo /srv/supabase ;;
      *compose.service*) echo functions ;;
      *compose.project*) echo lemtel-ha-standby ;;
    esac ;;
  compose) case " $* " in *" config "*) ${composeInvalid ? 'exit 1' : 'exit 0'} ;; *" up "*) touch "$F/up" ;; esac ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\n'); chmodSync(join(bin, 'sleep'), 0o755);
  const run = (mode, env = {}) => spawnSync('bash', [SCRIPT, mode], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, LEMTEL_ER_TEST_ROOT: root, ...env } });
  return { root, run, log: () => readFileSync(join(fake, 'log'), 'utf8') };
}
const GO = { LEMTEL_EDGE_REPAIR_EXECUTE: 'rebuild_edge_functions_compose_chain' };

test('check: base chain from a sibling container + every activation override on disk, missing names listed, nothing changed', () => {
  const w = world();
  const r = w.run('check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /base_from=supabase-rest/u);
  assert.match(r.stdout, /base_files=docker-compose\.yml,docker-compose\.email\.yml,docker-compose\.lemtel-private\.yml/u);
  assert.match(r.stdout, /activation_overrides=compose\.lemtel-transactional-email\.yml,edge-resource-publisher\.override\.yaml,edge-traffic\.override\.yaml/u);
  assert.match(r.stdout, /missing_variable_names_now=RESEND_API_KEY,LEMTEL_WELCOME_FROM,LEMTEL_DO_WRITER_RESOURCE_SECRET,LEMTEL_TRAFFIC_COLLECTOR_SECRET/u);
  assert.doesNotMatch(w.log(), / up /u);
});
test('repair recreates only the functions service with the full chain and proves every name', () => {
  const w = world();
  assert.equal(reason(w.run('repair')), 'execution_token_required');
  const r = w.run('repair', GO);
  assert.equal(r.status, 0, r.stderr);
  const up = w.log().split('\n').find((l) => l.includes(' up '));
  for (const part of ['--env-file', 'edge-secret.env', 'compose.lemtel-transactional-email.yml', 'edge-traffic.override.yaml', 'docker-compose.email.yml', '--no-deps --force-recreate']) assert.ok(up.includes(part), part);
  assert.match(r.stdout, /all_expected_variable_names_present=true/u);
});
test('refusals: invalid chain before any change, and a name still missing after recreate', () => {
  const bad = world({ composeInvalid: true });
  assert.equal(reason(bad.run('repair', GO)), 'compose_chain_invalid');
  assert.doesNotMatch(bad.log(), / up /u);
  assert.equal(reason(world({ upLosesTraffic: true }).run('repair', GO)), 'variables_still_missing_lemtel_traffic_collector_secret');
});
