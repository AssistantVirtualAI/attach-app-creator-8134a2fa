import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const relay = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-private-postgres-relay-enable.sh'), 'utf8');
const writer = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-postgres-streaming-prepare.sh'), 'utf8');
const standby = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-standby-postgres-basebackup.sh'), 'utf8');

for (const [label, source] of [['relay', relay], ['writer', writer], ['standby', standby]]) {
  test(`${label} inverse PostgreSQL component is root-only and explicitly role-gated`, () => {
    assert.match(source, /^#!\/usr\/bin\/env bash/mu);
    assert.match(source, /\[ "\$\(id -u\)" -eq 0 \]/u);
    assert.match(source, /LEMTEL_HA_EXECUTE/u);
    assert.match(source, /fusionpbx_or_sip_contacted=false/u);
    assert.match(source, /automatic_promotion_enabled=false/u);
    assert.doesNotMatch(source, /(?:pg_promote|cloudflare|\bnsupdate\b|\bturn\b|\bwss\b|https?:\/\/|DIGITALOCEAN_TOKEN|HOSTINGER_API_TOKEN)/imu);
  });
}

test('DO relay binds only to its WireGuard address and limits the source to Hostinger private tunnel', () => {
  assert.match(relay, /writer_tunnel_address='10\.253\.47\.2'/u);
  assert.match(relay, /standby_tunnel_address='10\.253\.47\.1'/u);
  assert.match(relay, /TCP-LISTEN:5432,bind=\$\{writer_tunnel_address\},reuseaddr,fork/u);
  assert.match(relay, /allow in on lemtel-ha0/u);
  assert.match(relay, /database_port_already_published/u);
  assert.match(relay, /HostConfig\.NetworkMode/u);
  assert.match(relay, /database_backend_target='127\.0\.0\.1:5432'/u);
  assert.match(relay, /private_relay_listener_verified=true/u);
  assert.match(relay, /public_database_listener_enabled=false/u);
  assert.match(relay, /rollback\(\)/u);
  assert.doesNotMatch(relay, /(?:--publish|-p\s*5432|pg_basebackup|pg_promote)/imu);
  assert.doesNotMatch(relay, /TCP-LISTEN:5432,bind=(?:0\.0\.0\.0|\*|\[::\])/imu);
});

test('DO writer creates a WireGuard-only replication policy and encrypted Hostinger envelope', () => {
  assert.match(writer, /declared_role=digitalocean_writer/u);
  assert.match(writer, /writer_tunnel_address='10\.253\.47\.2'/u);
  assert.match(writer, /standby_tunnel_address='10\.253\.47\.1'/u);
  assert.match(writer, /host replication \$\{replication_role\} \$\{standby_tunnel_address\}\/32 scram-sha-256/u);
  assert.match(writer, /pg_create_physical_replication_slot/u);
  assert.match(writer, /age -r "\$age_recipient"/u);
  assert.match(writer, /docker port "\$db_container" \| grep -q \./u);
  assert.match(writer, /pg_reload_conf/u);
  assert.match(writer, /rollback\(\)/u);
  assert.match(writer, /plaintext_secret_replication=false/u);
  assert.match(writer, /database_public_listener_enabled=false/u);
  assert.doesNotMatch(writer, /(?:--publish|-p\s*5432|pg_basebackup|pg_promote|docker\s+compose\s+up|\brsync\b|\brestic\b)/imu);
});

test('Hostinger standby uses pg_basebackup over WireGuard without a host or public PostgreSQL listener', () => {
  assert.match(standby, /declared_role=hostinger_standby/u);
  assert.match(standby, /-h "\$writer_tunnel_address" -p 5432/u);
  assert.match(standby, /-S "\$replication_slot"/u);
  assert.match(standby, /SELECT pg_is_in_recovery\(\).*grep -qx t/u);
  assert.match(standby, /wal_receiver_status=streaming/u);
  assert.match(standby, /docker port "\$container" \| grep -q \./u);
  assert.match(standby, /host_postgres_listener_enabled=false/u);
  assert.match(standby, /public_database_listener_enabled=false/u);
  assert.match(standby, /passfile=\/var\/lib\/postgresql\/data\/lemtel-ha-replication\.pgpass/u);
  assert.doesNotMatch(standby, /(?:--publish|docker run -d[\s\S]{0,500}-p\s*5432|pg_promote|docker\s+compose\s+up|\brsync\b|\brestic\b)/imu);
});
