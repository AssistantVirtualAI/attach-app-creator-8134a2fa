import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const keyInitPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-wireguard-key-init.sh');
const configurePath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-wireguard-configure.sh');

const source = (path) => readFileSync(path, 'utf8');
const forbiddenDataPlaneCommands = /(?:pg_basebackup|CREATE\s+ROLE|ALTER\s+(?:ROLE|SYSTEM)|pg_promote|\bpsql\b|docker\s+(?:run|compose|exec)|rsync|lsyncd|restic|\bnsupdate\b)/imu;

test('WireGuard key initializer stays root-only, local, and inactive', () => {
  const value = source(keyInitPath);
  assert.match(value, /^#!\/usr\/bin\/env bash/mu);
  assert.match(value, /require_root/u);
  assert.match(value, /wireguard_key_status=complete/u);
  assert.match(value, /wireguard_interface_started=false/u);
  assert.match(value, /firewall_changed=false/u);
  assert.match(value, /apt-get install -y --no-install-recommends wireguard-tools/u);
  assert.match(value, /wg genkey/u);
  assert.doesNotMatch(value, /wg-quick|systemctl|ufw\s+(?:allow|deny|enable|disable)|iptables|nft\s+(?:add|delete|flush)/u);
  assert.doesNotMatch(value, forbiddenDataPlaneCommands);
});

test('WireGuard tunnel configuration accepts only the fixed HA topology and no public database binding', () => {
  const value = source(configurePath);
  assert.match(value, /^#!\/usr\/bin\/env bash/mu);
  assert.match(value, /require_root/u);
  assert.match(value, /10\.253\.47\.1\/30/u);
  assert.match(value, /10\.253\.47\.2\/30/u);
  assert.match(value, /AllowedIPs = \$\{peer_address\}/u);
  assert.match(value, /PersistentKeepalive = 25/u);
  assert.match(value, /public_database_listener_enabled=false/u);
  assert.match(value, /systemctl enable --now/u);
  assert.match(value, /ufw allow from/u);
  assert.match(value, /service_start_failed_configuration_removed/u);
  assert.doesNotMatch(value, forbiddenDataPlaneCommands);
  assert.doesNotMatch(value, /(?:0\.0\.0\.0|::).*5432/u);
});

test('WireGuard scripts do not embed key material, public peer addresses, or web endpoints', () => {
  for (const path of [keyInitPath, configurePath]) {
    const value = source(path);
    assert.doesNotMatch(value, /BEGIN (?:OPENSSH|PRIVATE) KEY/u);
    assert.doesNotMatch(value, /(?:179\.236\.235\.108|192\.241\.137\.143)/u);
    assert.doesNotMatch(value, /https?:\/\//u);
  }
});
