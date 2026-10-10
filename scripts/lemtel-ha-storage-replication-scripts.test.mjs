import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = (name) => readFileSync(resolve(root, `infra/lemtel-resilience/active-passive/${name}`), 'utf8');
const primaryKeyInit = script('lemtel-ha-storage-primary-key-init.sh');
const standbyReceiver = script('lemtel-ha-storage-standby-receiver-bootstrap.sh');
const standbySshAllowuser = script('lemtel-ha-storage-standby-ssh-allowuser-enable.sh');
const primarySync = script('lemtel-ha-storage-primary-sync.sh');

const prohibited = /(?:\bpg_promote\b|docker\s+(?:run|compose\s+up)|\bnsupdate\b)/imu;

test('Storage key initialization is root-only, backend-specific, and pins the standby host key', () => {
  assert.match(primaryKeyInit, /\[ "\$\(id -u\)" -eq 0 \]/u);
  assert.match(primaryKeyInit, /initialize_private_storage_sync_key/u);
  assert.match(primaryKeyInit, /LEMTEL_HA_STORAGE_BACKEND:-\}" = local_filesystem/u);
  assert.match(primaryKeyInit, /standby_host='10\.253\.47\.2'/u);
  assert.match(primaryKeyInit, /LEMTEL_HA_STANDBY_HOST_KEY/u);
  assert.match(primaryKeyInit, /ssh-keygen -q -t ed25519/u);
  assert.doesNotMatch(primaryKeyInit, prohibited);
});

test('Storage receiver is WireGuard-only and accepts only the pinned rsync write protocol', () => {
  assert.match(standbyReceiver, /bootstrap_private_storage_receiver/u);
  assert.match(standbyReceiver, /useradd --system/u);
  assert.match(standbyReceiver, /--shell \/usr\/sbin\/nologin/u);
  assert.match(standbyReceiver, /from=\\"\$primary_tunnel_address\\",restrict,command=/u);
  assert.match(standbyReceiver, /SSH_ORIGINAL_COMMAND/u);
  assert.match(standbyReceiver, /--partial-dir/u);
  assert.match(standbyReceiver, /\.lemtel-ha-manifest\.current\.sha256/u);
  assert.match(standbyReceiver, /exit 126/u);
  assert.doesNotMatch(standbyReceiver, prohibited);
});

test('Storage receiver SSH access extends only the existing AllowUsers rule transactionally', () => {
  assert.match(standbySshAllowuser, /allow_private_storage_receiver_ssh/u);
  assert.match(standbySshAllowuser, /expected_original='AllowUsers lemtelops'/u);
  assert.match(standbySshAllowuser, /\$\{receiver_user\}@\$\{primary_tunnel_address\}/u);
  assert.match(standbySshAllowuser, /\[ "\$\{#allowuser_matches\[@\]\}" -eq 1 \]/u);
  assert.match(standbySshAllowuser, /\/usr\/sbin\/sshd -t/u);
  assert.match(standbySshAllowuser, /trap rollback ERR/u);
  assert.match(standbySshAllowuser, /existing_admin_access_retained=true/u);
  assert.doesNotMatch(standbySshAllowuser, /PermitRootLogin\s+yes|PasswordAuthentication\s+yes|AllowUsers\s+root/u);
  assert.doesNotMatch(standbySshAllowuser, prohibited);
});

test('Storage sync is one-way, locked, checksummed, and does not propagate deletions', () => {
  assert.match(primarySync, /sync_private_storage_once/u);
  assert.match(primarySync, /LEMTEL_HA_STORAGE_BACKEND:-\}" = local_filesystem/u);
  assert.match(primarySync, /flock -n 9/u);
  assert.match(primarySync, /--checksum/u);
  assert.match(primarySync, /--delay-updates/u);
  assert.match(primarySync, /--partial-dir=\.lemtel-ha-partial/u);
  assert.match(primarySync, /--no-owner --no-group/u);
  assert.match(primarySync, /StrictHostKeyChecking=yes/u);
  assert.match(primarySync, /-b \$primary_tunnel_address/u);
  assert.match(primarySync, /storage_manifest_sha256/u);
  assert.match(primarySync, /storage_delete_propagation_enabled=false/u);
  assert.doesNotMatch(primarySync, /--delete/u);
  assert.doesNotMatch(primarySync, prohibited);
});
