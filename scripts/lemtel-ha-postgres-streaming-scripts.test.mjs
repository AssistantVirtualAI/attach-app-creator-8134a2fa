import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const primary = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-postgres-streaming-prepare.sh'), 'utf8');
const standby = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-postgres-basebackup.sh'), 'utf8');
const standbyRecoveryRemediate = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-postgres-recovery-remediate.sh'), 'utf8');

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
  assert.match(primary, /expected_hba_rule="host replication \$\{replication_role\} \$\{standby_tunnel_address\}\/32 scram-sha-256"/u);
  assert.match(primary, /pg_create_physical_replication_slot/u);
  assert.match(primary, /age -r/u);
  assert.match(primary, /printf '' \| age -r "\$age_recipient" -o \/dev\/null/u);
  assert.match(primary, /flock -n 9 \|\| fail concurrent_primary_streaming_prepare/u);
  assert.match(primary, /validate_rendered_ports none/u);
  assert.match(primary, /validate_rendered_ports private/u);
  assert.match(primary, /database_recreate_started=true\n"\$\{replication_compose_cmd\[@\]\}" up/u);
  assert.match(primary, /assert_private_runtime_binding \|\| fail private_database_binding_not_exact/u);
  assert.match(primary, /assert_no_runtime_bindings/u);
  assert.match(primary, /database_data_mount_after_recreate/u);
  assert.match(primary, /replication_role_lost_after_recreate/u);
  assert.match(primary, /replication_slot_lost_after_recreate/u);
  assert.match(primary, /insufficient_wal_senders/u);
  assert.match(primary, /insufficient_replication_slots/u);
  assert.match(primary, /require_exact active_hba_file/u);
  assert.match(primary, /replication_hba_rule_not_loaded/u);
  assert.match(primary, /rollback\(\)/u);
  assert.match(primary, /"\$\{base_compose_cmd\[@\]\}" up -d --no-deps --force-recreate "\$db_service"/u);
  assert.match(primary, /pg_drop_replication_slot/u);
  assert.match(primary, /rollback_on_failure_enabled=true/u);
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
  assert.match(standby, /hot_standby = on/u);
  assert.match(standby, /hot_standby_enable_failed/u);
  assert.match(standby, /pg_basebackup copies the primary configuration/u);
  assert.match(standby, /standby_started=false/u);
  assert.match(standby, /docker stop --time 15 "\$container"/u);
  assert.doesNotMatch(standby, /(?:--publish|docker run -d[\s\S]{0,500}-p\s*5432|pg_promote|docker\s+compose\s+up|\bnsupdate\b|rsync|restic)/imu);
});

test('standby recovery remediation requires a contained replica and cannot expose or promote it', () => {
  assert.match(standbyRecoveryRemediate, /require_root/u);
  assert.match(standbyRecoveryRemediate, /remediate_private_postgres_standby_recovery/u);
  assert.match(standbyRecoveryRemediate, /standby_container_must_be_stopped/u);
  assert.match(standbyRecoveryRemediate, /standby\.signal/u);
  assert.match(standbyRecoveryRemediate, /hot_standby = on/u);
  assert.match(standbyRecoveryRemediate, /docker start "\$container"/u);
  assert.match(standbyRecoveryRemediate, /docker stop --time 15 "\$container"/u);
  assert.match(standbyRecoveryRemediate, /wal_receiver_status=streaming/u);
  assert.doesNotMatch(standbyRecoveryRemediate, /(?:--publish|docker run -d[\s\S]{0,500}-p\s*5432|pg_promote|docker\s+compose\s+up|\bnsupdate\b|rsync|restic)/imu);
});
