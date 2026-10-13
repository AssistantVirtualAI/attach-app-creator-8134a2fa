import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = (name) => readFileSync(resolve(root, `infra/lemtel-resilience/active-passive/${name}`), 'utf8');
const receiver = script('lemtel-ha-hostinger-standby-storage-receiver-bootstrap.sh');
const keyInit = script('lemtel-ha-do-writer-storage-key-init.sh');
const sync = script('lemtel-ha-do-writer-storage-sync.sh');
const timer = script('lemtel-ha-do-writer-storage-timer-enable.sh');
const enable = script('lemtel-ha-do-writer-storage-replication-enable.sh');
const prohibited = /(?:\bpg_promote\b|docker\s+(?:run|compose\s+up)|\bnsupdate\b|--delete)/imu;

test('Hostinger receiver is restricted to the DO WireGuard writer and forced rsync', () => {
  assert.match(receiver, /bootstrap_hostinger_private_storage_receiver/u);
  assert.match(receiver, /hostinger_standby/u);
  assert.match(receiver, /writer_tunnel_address='10\.253\.47\.2'/u);
  assert.match(receiver, /from=\\"\$writer_tunnel_address\\",restrict,command=/u);
  assert.match(receiver, /receiver_not_allowed_by_sshd_policy/u);
  assert.match(receiver, /SSH_ORIGINAL_COMMAND/u);
  assert.match(receiver, /exit 126/u);
  assert.doesNotMatch(receiver, prohibited);
});

test('DO key installation requires a staged dedicated key and pins the Hostinger host key privately', () => {
  assert.match(keyInit, /initialize_do_writer_private_storage_sync_key/u);
  assert.match(keyInit, /digitalocean_writer/u);
  assert.match(keyInit, /staged_storage_key_missing/u);
  assert.match(keyInit, /ssh-keyscan -T 10 -t ed25519/u);
  assert.match(keyInit, /standby_host_key_mismatch/u);
  assert.match(keyInit, /rm -f "\$staged_key" "\$staged_public_key"/u);
  assert.doesNotMatch(keyInit, /cat "\$key_file\.pub"/u);
  assert.doesNotMatch(keyInit, prohibited);
});

test('DO Storage sync discovers the real local volume and sends checksummed data only to Hostinger', () => {
  assert.match(sync, /sync_do_writer_private_storage_once/u);
  assert.match(sync, /digitalocean_writer/u);
  assert.match(sync, /docker inspect --format/u);
  assert.match(sync, /tr -d '\[\[:space:\]\]'/u);
  assert.doesNotMatch(sync, /tr -d '\[:space:\]'/u);
  assert.match(sync, /invalid_storage_source_mount/u);
  assert.match(sync, /sync_direction=digitalocean_to_hostinger_only/u);
  assert.match(sync, /--checksum/u);
  assert.match(sync, /--partial-dir=\.lemtel-ha-partial/u);
  assert.match(sync, /StrictHostKeyChecking=yes/u);
  assert.match(sync, /-b \$writer_tunnel_address/u);
  assert.match(sync, /storage_integrity_attestation_written=true/u);
  assert.match(sync, /storage_delete_propagation_enabled=false/u);
  assert.doesNotMatch(sync, prohibited);
});

test('DO Storage timer immediately verifies the first private sync then repeats with jitter', () => {
  assert.match(timer, /enable_do_writer_private_storage_sync_timer/u);
  assert.match(timer, /digitalocean_writer/u);
  assert.match(timer, /OnUnitActiveSec=5min/u);
  assert.match(timer, /RandomizedDelaySec=30s/u);
  assert.match(timer, /ProtectHome=read-only/u);
  assert.doesNotMatch(timer, /ProtectHome=true/u);
  assert.match(timer, /systemctl start lemtel-ha-do-writer-storage-sync\.service/u);
  assert.match(timer, /systemctl show -p Result --value lemtel-ha-do-writer-storage-sync\.service/u);
  assert.match(timer, /initial_sync_complete=true/u);
  assert.doesNotMatch(timer, prohibited);
});

test('Composite activation starts only the private Storage timer after key setup', () => {
  assert.match(enable, /enable_do_writer_private_storage_replication/u);
  assert.match(enable, /initialize_do_writer_private_storage_sync_key/u);
  assert.match(enable, /enable_do_writer_private_storage_sync_timer/u);
  assert.match(enable, /automatic_promotion_enabled=false/u);
  assert.doesNotMatch(enable, prohibited);
});
