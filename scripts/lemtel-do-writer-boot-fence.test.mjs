import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-boot-fence.sh');
function world({ streaming = '0', hostinger = '', arbiter = '{"state":"disabled_or_dry_run","reason":"disabled_or_dry_run"}', fenced = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-bf-')); const bin = join(root, 'bin'); mkdirSync(bin);
  const caddy = join(root, 'opt/lemtel-ha/runtime-stage/volumes/proxy/caddy'); mkdirSync(caddy, { recursive: true });
  writeFileSync(join(caddy, 'lemtel-lb-ready.json'), '{"status":"healthy"}');
  if (fenced) { mkdirSync(join(root, 'var/lib/lemtel-ha/boot-fence'), { recursive: true }); writeFileSync(join(root, 'var/lib/lemtel-ha/boot-fence/fenced'), 'reason=x\n'); }
  writeFileSync(join(bin, 'docker'), `#!/bin/bash
echo "$*" >> ${root}/docker.log
case "$1" in
  ps) if [[ "$*" == *label=* ]]; then printf 'c1\\nc2\\n'; else echo 'lemtel-postgres-standby|supabase/postgres:17.6.1.136'; fi;;
  exec) echo ${streaming};;
  stop) ;;
esac\n`);
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
if [[ "$*" == *--resolve* ]]; then printf '%s' '${hostinger}'; else printf '%s' '${arbiter}'; fi\n`);
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\n:\n');
  for (const f of ['docker', 'curl', 'sleep']) chmodSync(join(bin, f), 0o755);
  const run = (mode, env = {}) => spawnSync('bash', [script, mode], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`,
    LEMTEL_BF_TEST_ROOT: root, LEMTEL_BF_WAIT_SECONDS: '20', LEMTEL_BF_STEP_SECONDS: '10', ...env } });
  return { root, run, marker: join(caddy, 'lemtel-lb-ready.json'), confirmed: join(root, 'run/lemtel-ha/writer-authority-confirmed'),
    fencedFile: join(root, 'var/lib/lemtel-ha/boot-fence/fenced'), dockerLog: () => existsSync(join(root, 'docker.log')) ? readFileSync(join(root, 'docker.log'), 'utf8') : '' };
}
const promoted = '{"format":"lemtel_do_writer_l7_ready_v1","writer_role":"hostinger_writer","definitive":true,"observed_at":1,"status":"healthy"}';

test('boot-clear always removes the readiness marker', () => {
  const w = world(); assert.equal(w.run('boot-clear').status, 0); assert.ok(!existsSync(w.marker));
});
test('standby streaming from DO confirms writer authority for this boot, without stopping anything', () => {
  const w = world({ streaming: '1' }); const r = w.run('decide');
  assert.match(r.stdout, /boot_fence=writer_authority_confirmed\nevidence=hostinger_standby_streaming_from_do/u);
  assert.ok(existsSync(w.confirmed)); assert.ok(!existsSync(w.marker), 'marker comes back only through the refresh timer');
  assert.ok(!w.dockerLog().includes('stop'));
});
for (const [label, options, reason] of [
  ['Hostinger serving as promoted writer', { streaming: '1', hostinger: promoted }, 'hostinger_serving_as_promoted_writer'],
  ['arbiter promotion in progress', { arbiter: '{"state":"manual_promotion_action_required","reason":"command_dispatched_to_agent"}' }, 'arbiter_incident_or_promotion_in_progress'],
  ['arbiter blocked after a fence intent', { arbiter: '{"state":"blocked","reason":"terminal_power_state_changed"}' }, 'arbiter_incident_or_promotion_in_progress'],
  ['a persisted fence state', { streaming: '1', fenced: true }, 'persisted_fence_state_requires_operator_unfence'],
  ['an undetermined authority', { arbiter: 'garbage' }, 'writer_authority_undetermined'],
]) {
  test(`stays fenced on ${label}: containers stopped, no authority, fence state written`, () => {
    const w = world(options); const r = w.run('decide');
    assert.match(r.stdout, new RegExp(`boot_fence=fenced\\nreason=${reason}`, 'u'));
    assert.ok(!existsSync(w.confirmed)); assert.ok(existsSync(w.fencedFile)); assert.ok(!existsSync(w.marker));
    assert.match(w.dockerLog(), /stop c1 c2/u);
  });
}
test('a quiet arbiter (including "standby not ready, no fencing") allows the writer after the bounded wait', () => {
  for (const arbiter of ['{"state":"disabled_or_dry_run","reason":"disabled_or_dry_run"}', '{"state":"blocked","reason":"standby_not_ready_no_fencing"}',
    '{"state":"blocked","reason":"l7_health_ambiguous_no_fencing"}']) {
    const w = world({ arbiter }); const r = w.run('decide');
    assert.match(r.stdout, /evidence=standby_unavailable_arbiter_quiet_hostinger_not_promoted/u, arbiter);
    assert.ok(existsSync(w.confirmed));
  }
});
test('unfence needs the explicit acknowledgement and refuses while Hostinger serves as writer', () => {
  let w = world({ fenced: true });
  assert.equal(w.run('unfence').status, 1);
  assert.equal(w.run('unfence', { LEMTEL_BF_UNFENCE_ACK: 'I_CONFIRM_DO_IS_THE_ONLY_WRITER' }).status, 0);
  assert.ok(!existsSync(w.fencedFile)); assert.ok(existsSync(w.confirmed));
  w = world({ fenced: true, hostinger: promoted });
  const r = w.run('unfence', { LEMTEL_BF_UNFENCE_ACK: 'I_CONFIRM_DO_IS_THE_ONLY_WRITER' });
  assert.equal(r.status, 1); assert.match(r.stdout, /hostinger_still_serving_as_writer/u); assert.ok(existsSync(w.fencedFile));
});
test('installer gates marker and Storage copy on authority and confirms authority before adding conditions', () => {
  const apply = readFileSync(resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-boot-fence-apply.sh'), 'utf8');
  assert.ok(apply.indexOf('" decide)"') < apply.indexOf('ConditionPathExists=/run/lemtel-ha/writer-authority-confirmed'));
  for (const unit of ['lemtel-ha-do-writer-lb-ready.service', 'lemtel-ha-do-writer-storage-sync.service']) assert.ok(apply.includes(unit));
  assert.match(apply, /Before=docker\.service/u);
  assert.doesNotMatch(apply, /docker (stop|rm|compose)/u);
});
