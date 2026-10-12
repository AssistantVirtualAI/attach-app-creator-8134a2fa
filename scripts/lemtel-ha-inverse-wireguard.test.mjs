import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const hostinger = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-standby-wireguard-configure.sh'), 'utf8');
const writer = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-wireguard-peer-apply.sh'), 'utf8');

for (const [name, source] of [['hostinger', hostinger], ['writer', writer]]) {
  test(`${name} inverse WireGuard script requires an explicit execution token and role`, () => {
    assert.match(source, /LEMTEL_HA_EXECUTE/);
    assert.match(source, /LEMTEL_HA_ROLE/);
    assert.match(source, /root_required/);
  });

  test(`${name} inverse WireGuard script preserves the no-public-data boundary`, () => {
    assert.match(source, /private_database_listener_enabled=false/);
    assert.match(source, /automatic_promotion_enabled=false/);
    assert.match(source, /fusionpbx_or_sip_contacted=false/);
    assert.match(source, /credential_values_emitted=false/);
    assert.doesNotMatch(source, /0\.0\.0\.0:5432/);
  });
}

test('Hostinger connects as the private standby initiator only', () => {
  assert.match(hostinger, /hostinger_standby/);
  assert.match(hostinger, /10\.253\.47\.2\/30/);
  assert.match(hostinger, /10\.253\.47\.1\/32/);
  assert.match(hostinger, /PersistentKeepalive = 25/);
  assert.match(hostinger, /postgres_started=false/);
  assert.match(hostinger, /runtime_started=false/);
});

test('DO replaces exactly one fenced peer transactionally before any database step', () => {
  assert.match(writer, /expected_exactly_one_former_peer/);
  assert.match(writer, /cp -a \"\$config_path\" \"\$backup_conf\"/);
  assert.match(writer, /wg showconf \"\$interface\" > \"\$backup_runtime\"/);
  assert.match(writer, /trap rollback ERR/);
  assert.match(writer, /wg set \"\$interface\" peer \"\$old_peer\" remove/);
  assert.match(writer, /wg set \"\$interface\" peer \"\$new_peer_key\" allowed-ips/);
  assert.match(writer, /postgres_changed=false/);
  assert.match(writer, /storage_changed=false/);
  assert.match(writer, /runtime_changed=false/);
});
