import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const primary = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-postgres-streaming-prepare.sh'), 'utf8');
const standby = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-postgres-basebackup.sh'), 'utf8');

for (const [label, source] of [['primary', primary], ['standby', standby]]) {
  test(`${label} PostgreSQL streaming script is root-only and requires an execution token`, () => {
    assert.match(source, /^#!\/usr\/bin\/env bash/mu);
    assert.match(source, /require_root/u);
    assert.match(source, /LEMTEL_HA_EXECUTE/u);
    assert.match(source, /fusionpbx_or_sip_contacted=false/u);
    assert.match(source, /public_database_listener_enabled=false/u);
    assert.match(source, /automatic_promotion_enabled=false/u);
    assert.doesNotMatch(source, /(?:\bnsupdate\b|cloudflare|ionos|\bturn\b|\bwss\b|https?:\/\/|192\.241\.137\.143|179\.236\.235\.108)/imu);
  });
}

test('primary binds PostgreSQL only to the WireGuard address and protects replication credentials', () => {
  assert.match(primary, /primary_tunnel_address='10\.253\.47\.1'/u);
  assert.match(primary, /"\$\{primary_tunnel_address\}:5432:5432"/u);
  assert.match(primary, /standby_tunnel_address='10\.253\.47\.2'/u);
  assert.match(primary, /\$\{standby_tunnel_address\}\/32/u);
  assert.match(primary, /host replication %s %s\/32 scram-sha-256/u);
  assert.match(primary, /pg_create_physical_replication_slot/u);
  assert.match(primary, /age -r/u);
  assert.match(primary, /plaintext_secret_replication=false/u);
  assert.doesNotMatch(primary, /(?:0\.0\.0\.0:5432|::.*5432|docker\s+compose\s+down|pg_promote|rsync|restic)/imu);
});

test('standby receives a base backup through the private tunnel without publishing a database port', () => {
  assert.match(standby, /pg_basebackup/u);
  assert.match(standby, /-h "\$primary_tunnel_address"/u);
  assert.match(standby, /-S lemtel_do_standby/u);
  assert.match(standby, /SELECT pg_is_in_recovery\(\)/u);
  assert.match(standby, /wal_receiver_status=streaming/u);
  assert.match(standby, /docker run -d --name "\$container"/u);
  assert.match(standby, /passfile=\/var\/lib\/postgresql\/data\/lemtel-ha-replication\.pgpass/u);
  assert.match(standby, /install -d -m 0700 \/etc\/lemtel-ha\/secrets "\$data_dir"\nif find "\$data_dir"/u);
  assert.doesNotMatch(standby, /(?:--publish|docker run -d[\s\S]{0,500}-p\s*5432|pg_promote|docker\s+compose\s+up|\bnsupdate\b|rsync|restic)/imu);
});
