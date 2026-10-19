import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { world } from './lemtel-failback-fake-tools.mjs';

// Offline: fake docker/systemctl/ss/curl/age; real filesystem moves under a temporary root.
const dir = resolve(import.meta.dirname, '../infra/lemtel-resilience/failback');
const script = (name) => join(dir, name);
const REBUILD_DO = script('lemtel-ha-do-standby-rebuild-from-hostinger.sh');
const H_REPL = script('lemtel-ha-hostinger-writer-replication-enable.sh');
const HANDBACK = script('lemtel-ha-hostinger-writer-handback.sh');
const PROMOTE = script('lemtel-ha-do-promote-after-handback.sh');
const REBUILD_H = script('lemtel-ha-hostinger-standby-rebuild-from-do.sh');
const SYNC = script('lemtel-ha-do-writer-synchronous-standby-restore.sh');
const STORAGE = script('lemtel-ha-do-storage-receive-from-hostinger.sh');
const reason = (r) => (r.stderr.match(/reason=([a-z0-9_]+)/u) || [])[1];

// ---- step 2: DigitalOcean rebuilt as a standby of the promoted Hostinger --------------------------------------
function doWorld(overrides = {}) {
  return world({
    files: { 'var/lib/lemtel-ha/boot-fence/fenced': 'reason=x\n',
      'etc/lemtel-ha/secrets/postgres-replication-hostinger.password': { text: 'abc123def456\n', mode: 0o600 }, ...(overrides.files || {}) },
    containers: { 'lemtel-postgres-standby': { env: 'POSTGRES_PASSWORD=x\nPGPORT=5432\n',
      networks: 'bridge=\nlemtel-ha-standby_default=db,lemtel-postgres-standby,0123456789ab\n' } },
    projects: { 'lemtel-ha-standby': { running: overrides.runtimeRunning ? ['r1'] : [], all: ['r1', 'r2'] } },
    clientSql: overrides.clientSql || [['pg_is_in_recovery', 'f'], ['pg_replication_slots', '1']],
    sql: [['hba_file', '/etc/postgresql/pg_hba.conf'], ['pg_is_in_recovery', 't'], ['pg_stat_wal_receiver', 'streaming']],
  });
}
const DO_ENV = { LEMTEL_HA_EXECUTE: 'rebuild_do_standby_from_promoted_hostinger', LEMTEL_HA_ACK: 'I_UNDERSTAND_DO_DATABASE_IS_REPLACED_BY_A_COPY_OF_HOSTINGER' };

test('step 2: DigitalOcean becomes a streaming standby of Hostinger; the old database directory is kept', () => {
  const w = doWorld();
  const r = w.run(REBUILD_DO, [], DO_ENV);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /wal_receiver_status=streaming/u);
  const base = join(w.root, 'opt/lemtel-ha/postgres');
  const retired = readdirSync(base).filter((n) => n.startsWith('data.retired-'));
  assert.equal(retired.length, 1);
  assert.ok(existsSync(join(base, retired[0], 'PG_VERSION')), 'old cluster preserved');
  const auto = readFileSync(join(base, 'data/postgresql.auto.conf'), 'utf8');
  assert.match(auto, /primary_conninfo = 'host=10\.253\.47\.1 port=5432 user=lemtel_ha_replication application_name=lemtel_do_standby passfile=/u);
  assert.match(auto, /primary_slot_name = 'lemtel_do_standby'/u);
  assert.doesNotMatch(auto, /synchronous_standby_names/u, 'a standby never inherits a synchronous setting');
  assert.match(auto, /shared_buffers = 128MB/u, 'other settings kept');
  assert.ok(existsSync(join(base, 'data/lemtel-ha-replication.pgpass')));
  assert.deepEqual(w.containerNames(), ['lemtel-postgres-standby'], 'retired container removed, new one in place');
  const log = w.log();
  assert.match(log, /docker network connect --alias db lemtel-ha-standby_default lemtel-postgres-standby/u);
  assert.doesNotMatch(log, /--alias 0123456789ab|--alias lemtel-postgres-standby/u);
  assert.match(log, /--env-file \/run\/lemtel-ha\/do-standby-rebuild\/env/u);
  assert.ok(log.indexOf('IDENTIFY_SYSTEM') < log.indexOf('docker stop'), 'replication login proven before anything changes');
  assert.ok(log.indexOf('docker stop') < log.indexOf('pg_basebackup'));
  assert.ok(log.indexOf('docker cp') < log.indexOf('docker start lemtel-postgres-standby'), 'hba file restored before start');
  assert.match(log, /systemctl restart lemtel-ha-do-postgres-wireguard-relay\.service/u);
  assert.match(w.read('basebackup'), /-S lemtel_do_standby/u);
  assert.equal(existsSync(join(w.root, 'run/lemtel-ha/do-standby-rebuild/pgpass')), false, 'no secret left in /run');
});

test('step 2 refuses before any change: not fenced, runtime running, Hostinger not writer, slot or login missing, no acknowledgement', () => {
  const cases = [
    [{ files: { 'var/lib/lemtel-ha/boot-fence/fenced': undefined } }, DO_ENV, 'do_not_fenced_run_only_after_failover'],
    [{ runtimeRunning: true }, DO_ENV, 'do_runtime_still_running'],
    [{ clientSql: [['pg_is_in_recovery', 't'], ['pg_replication_slots', '1']] }, DO_ENV, 'hostinger_not_reachable_as_writer'],
    [{ clientSql: [['pg_is_in_recovery', 'f'], ['pg_replication_slots', '0']] }, DO_ENV, 'hostinger_slot_missing_run_step_1'],
    [{}, { ...DO_ENV, LEMTEL_HA_ACK: 'yes' }, 'acknowledgement_required'],
  ];
  for (const [overrides, env, code] of cases) {
    const files = { ...(overrides.files || {}) };
    for (const [k, v] of Object.entries(files)) if (v === undefined) delete files[k];
    const w = doWorld({ ...overrides, files });
    if (overrides.files && 'var/lib/lemtel-ha/boot-fence/fenced' in overrides.files) {
      execFileSync('rm', ['-f', join(w.root, 'var/lib/lemtel-ha/boot-fence/fenced')]);
    }
    const r = w.run(REBUILD_DO, [], env);
    assert.equal(reason(r), code, r.stderr);
    assert.doesNotMatch(w.log(), /docker (stop|rename)/u, `${code}: nothing changed`);
    assert.ok(existsSync(join(w.root, 'opt/lemtel-ha/postgres/data/PG_VERSION')));
  }
  const refused = doWorld(); refused.flag('replication-login-refused');
  assert.equal(reason(refused.run(REBUILD_DO, [], DO_ENV)), 'hostinger_replication_login_refused');
  assert.doesNotMatch(refused.log(), /docker (stop|rename)/u);
});

test('step 2 rolls back to the previous database (stopped) when the base backup fails', () => {
  const w = doWorld(); w.flag('basebackup-fails');
  const r = w.run(REBUILD_DO, [], DO_ENV);
  assert.equal(reason(r), 'basebackup_failed');
  assert.match(r.stderr, /rollback=previous_database_restored_stopped/u);
  assert.ok(existsSync(join(w.root, 'opt/lemtel-ha/postgres/data/PG_VERSION')), 'data directory restored');
  assert.deepEqual(w.containerNames(), ['lemtel-postgres-standby'], 'container name restored');
  assert.equal(readdirSync(join(w.root, 'opt/lemtel-ha/postgres')).filter((n) => n.startsWith('data.retired-')).length, 0);
});

// ---- step 1: Hostinger (promoted) serves replication to DigitalOcean ---------------------------------------
function hWriter(sqlOverrides = [], ss = 'LISTEN 0 5 10.253.47.1:5432 0.0.0.0:*\n') {
  return world({ containers: { 'lemtel-postgres-hostinger-standby': {} }, ss,
    sql: [...sqlOverrides, ['pg_is_in_recovery', 'f'], ['pg_roles', '1'], ['pg_hba_file_rules', '1'], ['hba_file', '/etc/postgresql/pg_hba.conf'],
      ['pg_reload_conf', 't'], ['SELECT count(*) FROM pg_replication_slots', '0'],
      ['pg_create_physical_replication_slot', 'x'], ['SELECT slot_type', 'physical']] });
}
test('step 1: replication rule, slot and a relay bound to the tunnel accepting only the DigitalOcean peer', () => {
  const w = hWriter();
  const r = w.run(H_REPL, ['install'], { LEMTEL_HA_EXECUTE: 'enable_hostinger_writer_replication_for_failback' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(w.read('hba-writes'), /hba-append/u);
  assert.match(w.log(), /pg_create_physical_replication_slot\('lemtel_do_standby', true\)/u);
  const relay = readFileSync(join(w.root, 'usr/local/libexec/lemtel-ha-hostinger-postgres-wireguard-relay'), 'utf8');
  assert.match(relay, /TCP-LISTEN:5432,bind=10\.253\.47\.1,reuseaddr,fork,range=10\.253\.47\.2\/32/u);
  assert.match(relay, /index \.NetworkSettings\.Networks "bridge"/u, 'relay pinned to the default bridge network');
  assert.match(w.log(), /sql .*address = '172\.17\.0\.1'/u, 'hba rule for the docker0 address');
  assert.match(readFileSync(join(w.root, 'etc/systemd/system/lemtel-ha-hostinger-postgres-wireguard-relay.service'), 'utf8'), /Requires=wg-quick@lemtel-ha0/u);
});
test('step 1 refuses on a standby (before promotion) and with any other :5432 listener', () => {
  const standby = hWriter([['pg_is_in_recovery', 't']]);
  assert.equal(reason(standby.run(H_REPL, ['install'], { LEMTEL_HA_EXECUTE: 'enable_hostinger_writer_replication_for_failback' })), 'hostinger_not_promoted_writer');
  assert.equal(standby.read('hba-writes'), '');
  const exposed = hWriter([], 'LISTEN 0 5 10.253.47.1:5432 0.0.0.0:*\nLISTEN 0 5 0.0.0.0:5432 0.0.0.0:*\n');
  assert.equal(reason(exposed.run(H_REPL, ['install'], { LEMTEL_HA_EXECUTE: 'enable_hostinger_writer_replication_for_failback' })), 'unexpected_postgres_listener');
});

// ---- step 3: hand-back on Hostinger --------------------------------------------------------------------------
function hHandback(sql) {
  return world({ containers: { 'lemtel-postgres-hostinger-standby': {} },
    projects: { 'lemtel-ha-hostinger-promoted': { running: ['p1', 'p2'] } },
    files: { 'opt/lemtel-ha/runtime-stage/volumes/proxy/caddy/lemtel-lb-ready.json': '{}' },
    sql: [...sql, ['pg_is_in_recovery', 'f'], ["application_name = 'lemtel_do_standby'", '1'], ['pg_terminate_backend', '0'],
      ['CHECKPOINT', ''], ['pg_current_wal_lsn', '0/5000060'], ['pg_wal_lsn_diff', 't']] });
}
const HB = { LEMTEL_HA_EXECUTE: 'hand_back_hostinger_writer_to_digitalocean' };
test('step 3: quiesce stops the runtime and marker, then fence stops the database only once DigitalOcean caught up', () => {
  const w = hHandback([]);
  const q = w.run(HANDBACK, ['quiesce'], HB);
  assert.equal(q.status, 0, q.stdout + q.stderr);
  assert.match(q.stdout, /final_lsn=0\/5000060/u);
  assert.equal(existsSync(join(w.root, 'opt/lemtel-ha/runtime-stage/volumes/proxy/caddy/lemtel-lb-ready.json')), false);
  assert.match(w.log(), /docker stop --time 30 p1 p2/u);
  assert.equal(reason(w.run(HANDBACK, ['fence'], HB)), 'do_replayed_lsn_required');
  const f = w.run(HANDBACK, ['fence'], { ...HB, LEMTEL_HA_DO_REPLAYED_LSN: '0/5000060' });
  assert.equal(f.status, 0, f.stdout + f.stderr);
  assert.match(w.log(), /docker update --restart=no lemtel-postgres-hostinger-standby/u);
  assert.equal(readFileSync(join(w.fake, 'containers/lemtel-postgres-hostinger-standby/running'), 'utf8').trim(), 'false');
  assert.match(w.log(), /systemctl disable --now lemtel-ha-hostinger-postgres-wireguard-relay\.service/u);
});
test('step 3 refuses to quiesce without a streaming DigitalOcean standby, and to fence while DigitalOcean is behind', () => {
  const lonely = hHandback([["application_name = 'lemtel_do_standby'", '0']]);
  assert.equal(reason(lonely.run(HANDBACK, ['quiesce'], HB)), 'do_standby_not_streaming_run_step_2');
  assert.doesNotMatch(lonely.log(), /docker stop/u);
  const behind = hHandback([['pg_wal_lsn_diff', 'f']]);
  behind.run(HANDBACK, ['quiesce'], HB);
  assert.equal(reason(behind.run(HANDBACK, ['fence'], { ...HB, LEMTEL_HA_DO_REPLAYED_LSN: '0/4000000' })), 'do_standby_behind_hostinger');
  assert.equal(readFileSync(join(behind.fake, 'containers/lemtel-postgres-hostinger-standby/running'), 'utf8').trim(), 'true');
});

// ---- step 4: DigitalOcean promoted back --------------------------------------------------------------------
function doPromote(sql, flags = []) {
  const w = world({ containers: { 'lemtel-postgres-standby': {} }, projects: { 'lemtel-ha-standby': { running: [], all: ['r1', 'r2'] } },
    sql: [...sql, ['pg_is_in_recovery', 't,,f'], ['pg_wal_lsn_diff', 't'], ['pg_last_wal_replay_lsn', '0/5000060'],
      ['pg_promote', 't'], ['ALTER SYSTEM', ''], ['pg_reload_conf', 't']] });
  const tool = join(w.root, 'usr/local/sbin/lemtel-ha-do-writer-boot-fence');
  mkdirSync(join(tool, '..'), { recursive: true });
  writeFileSync(tool, `#!/bin/bash\necho "fence $* ack=$LEMTEL_BF_UNFENCE_ACK" >> "${w.fake}/log"\n`); chmodSync(tool, 0o755);
  for (const f of flags) w.flag(f);
  return w;
}
const PR = { LEMTEL_HA_EXECUTE: 'promote_do_after_hostinger_handback', LEMTEL_HA_HOSTINGER_FINAL_LSN: '0/5000060' };
test('step 4: promotes DigitalOcean only after replaying Hostinger\'s final position with Hostinger fenced, then serves', () => {
  const w = doPromote([]);
  const r = w.run(PROMOTE, ['promote'], PR);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const log = w.log();
  assert.ok(log.indexOf('-h 10.253.47.1') < log.indexOf('pg_promote'), 'fence of Hostinger checked before promotion');
  assert.match(log, /ALTER SYSTEM SET synchronous_standby_names = ''/u);
  assert.match(log, /fence unfence ack=I_CONFIRM_DO_IS_THE_ONLY_WRITER/u);
  assert.match(log, /docker start r1 r2/u);
  assert.match(log, /--resolve lemtel-do-l7\.assistantvirtualai\.com:443:127\.0\.0\.1/u);
});
test('step 4 refuses while Hostinger still accepts logins or before the final position is replayed', () => {
  const open = doPromote([], ['hostinger-accepts-logins']);
  assert.equal(reason(open.run(PROMOTE, ['promote'], PR)), 'hostinger_still_accepts_logins_fence_it_first');
  assert.doesNotMatch(open.log(), /pg_promote/u);
  const behind = doPromote([['pg_wal_lsn_diff', 'f']]);
  assert.equal(reason(behind.run(PROMOTE, ['promote'], PR)), 'standby_has_not_replayed_hostinger_final_lsn');
  assert.doesNotMatch(behind.log(), /pg_promote/u);
  assert.equal(reason(doPromote([]).run(PROMOTE, ['promote'], { ...PR, LEMTEL_HA_HOSTINGER_FINAL_LSN: '' })), 'hostinger_final_lsn_required');
});

// ---- step 5: Hostinger back to standby ---------------------------------------------------------------------
function hRebuild(clientSql, extraFiles = {}) {
  const w = world({
    containers: { 'lemtel-postgres-hostinger-standby': { running: false } },
    projects: { 'lemtel-ha-hostinger-promoted': { running: [], all: ['p1', 'p2'] } },
    files: { 'var/lib/lemtel-ha/failback/fenced': 'x\n', 'var/lib/lemtel-ha/failback/quiesced': 'x\n',
      'etc/lemtel-ha/age/identity.txt': 'id', 'etc/lemtel-ha/secrets/replication-password-hostinger.age': 'env',
      'var/lib/lemtel-ha/current-topology-evidence/do-writer-fence-receipt.state': 'x',
      'var/lib/lemtel-ha/current-topology-evidence/hostinger-promotion.state': 'x',
      'etc/systemd/system/lemtel-ha-hostinger-lb-ready.timer': 'x', ...extraFiles },
    clientSql, sql: [['pg_is_in_recovery', 't'], ['pg_stat_wal_receiver', 'streaming']] });
  writeFileSync(join(w.fake, 'project-networks'), 'n1\n');
  mkdirSync(join(w.root, 'opt/lemtel-ha/runtime-stage/volumes'), { recursive: true });
  symlinkSync('/home/lemtelstorage/storage-current', join(w.root, 'opt/lemtel-ha/runtime-stage/volumes/storage'));
  return w;
}
const RH = { LEMTEL_HA_EXECUTE: 'rebuild_hostinger_standby_from_digitalocean' };
test('step 5: Hostinger becomes a clean standby of DigitalOcean (slot created, promoted runtime removed, evidence archived)', () => {
  const w = hRebuild([['pg_is_in_recovery', 'f'], ['pg_replication_slots', '']]);
  const r = w.run(REBUILD_H, [], RH);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(w.read('basebackup'), /-R -C -S lemtel_hostinger_standby/u);
  assert.match(w.log(), /docker rm -f p1 p2/u);
  assert.match(w.log(), /docker network rm n1/u);
  assert.equal(existsSync(join(w.root, 'opt/lemtel-ha/runtime-stage/volumes/storage')), false, 'storage link removed');
  assert.equal(existsSync(join(w.root, 'etc/systemd/system/lemtel-ha-hostinger-lb-ready.timer')), false);
  assert.deepEqual(readdirSync(join(w.root, 'var/lib/lemtel-ha/current-topology-evidence')), [], 'next failover starts clean');
  assert.deepEqual(w.containerNames(), ['lemtel-postgres-hostinger-standby'], 'exactly one postgres container (attestation)');
  const auto = readFileSync(join(w.root, 'opt/lemtel-ha/postgres/data/postgresql.auto.conf'), 'utf8');
  assert.match(auto, /application_name=lemtel_hostinger_standby/u);
  assert.doesNotMatch(auto, /synchronous_standby_names/u);
});
test('step 5 refuses before any change: not fenced, DigitalOcean not writer, slot in use', () => {
  for (const [clientSql, code, unfenced] of [
    [[['pg_is_in_recovery', 'f'], ['pg_replication_slots', '']], 'hostinger_not_fenced_by_handback', true],
    [[['pg_is_in_recovery', 't'], ['pg_replication_slots', '']], 'digitalocean_not_reachable_as_writer'],
    [[['pg_is_in_recovery', 'f'], ['pg_replication_slots', 'active']], 'slot_already_in_use'],
  ]) {
    const w = hRebuild(clientSql);
    if (unfenced) execFileSync('rm', ['-f', join(w.root, 'var/lib/lemtel-ha/failback/fenced')]);
    const r = w.run(REBUILD_H, [], RH);
    assert.equal(reason(r), code, r.stderr);
    assert.doesNotMatch(w.log(), /docker (rename|rm)/u, `${code}: nothing changed`);
  }
});

// ---- step 6: synchronous standby ----------------------------------------------------------------------------
test('step 6: restores FIRST 1 (lemtel_hostinger_standby) only with a streaming standby, reverts if it never becomes sync', () => {
  const ok = world({ containers: { 'lemtel-postgres-standby': {} }, sql: [['pg_is_in_recovery', 'f'], ["state = 'streaming'", '1'],
    ['ALTER SYSTEM', ''], ['pg_reload_conf', 't'], ['sync_state', 'async,,sync']] });
  const r = ok.run(SYNC, [], { LEMTEL_HA_EXECUTE: 'restore_do_synchronous_hostinger_standby' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const never = world({ containers: { 'lemtel-postgres-standby': {} }, sql: [['pg_is_in_recovery', 'f'], ["state = 'streaming'", '1'],
    ['ALTER SYSTEM', ''], ['pg_reload_conf', 't'], ['sync_state', 'async']] });
  assert.equal(reason(never.run(SYNC, [], { LEMTEL_HA_EXECUTE: 'restore_do_synchronous_hostinger_standby' })), 'hostinger_not_synchronous_reverted_to_async');
  assert.match(never.log(), /ALTER SYSTEM SET synchronous_standby_names = ''/u, 'writes never left blocked');
  const absent = world({ containers: { 'lemtel-postgres-standby': {} }, sql: [['pg_is_in_recovery', 'f'], ["state = 'streaming'", '0']] });
  assert.equal(reason(absent.run(SYNC, [], { LEMTEL_HA_EXECUTE: 'restore_do_synchronous_hostinger_standby' })), 'hostinger_standby_not_streaming');
  assert.doesNotMatch(absent.log(), /ALTER SYSTEM/u);
});

// ---- storage copy back to DigitalOcean ------------------------------------------------------------------------
test('storage: applied only when the received files match the Hostinger manifest; links refused; nothing deleted', () => {
  const w = world({ files: { 'home/lemtelstorage/storage-current/keep.txt': 'do-only', 'src/a/b.bin': 'payload', 'src/c.txt': 'new' } });
  const src = join(w.root, 'src');
  const tarball = execFileSync('tar', ['-C', src, '-cf', '-', '.']);
  const manifest = execFileSync('bash', ['-c', `cd '${src}' && LC_ALL=C find . -type f -print0 | sort -z | xargs -0r sha256sum`]).toString();
  const sha = createHash('sha256').update(`${manifest.replace(/\n$/u, '')}\n`).digest('hex');
  const env = { LEMTEL_HA_EXECUTE: 'receive_hostinger_storage_for_failback', LEMTEL_HA_EXPECTED_MANIFEST_SHA256: sha };
  const bad = w.run(STORAGE, [], { ...env, LEMTEL_HA_EXPECTED_MANIFEST_SHA256: 'f'.repeat(64) }, tarball);
  assert.equal(reason(bad), 'manifest_mismatch_nothing_applied');
  assert.equal(existsSync(join(w.root, 'home/lemtelstorage/storage-current/c.txt')), false);
  const r = w.run(STORAGE, [], env, tarball);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(w.root, 'home/lemtelstorage/storage-current/a/b.bin'), 'utf8'), 'payload');
  assert.equal(readFileSync(join(w.root, 'home/lemtelstorage/storage-current/keep.txt'), 'utf8'), 'do-only', 'nothing deleted on DO');
  symlinkSync('/etc/passwd', join(src, 'evil'));
  const linked = execFileSync('tar', ['-C', src, '-cf', '-', '.']);
  assert.equal(reason(w.run(STORAGE, [], env, linked)), 'unexpected_file_type');
});
