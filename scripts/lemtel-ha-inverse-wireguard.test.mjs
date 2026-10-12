import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const hostinger = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-standby-wireguard-configure.sh'), 'utf8');
const realign = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-standby-wireguard-reconfigure.sh'), 'utf8');
const writer = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-wireguard-peer-apply.sh'), 'utf8');

for (const [name, source] of [['hostinger', hostinger], ['realign', realign], ['writer', writer]]) {
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

test('Hostinger connects as the private standby at the former primary address', () => {
  assert.match(hostinger, /hostinger_standby/);
  assert.match(hostinger, /10\.253\.47\.1\/30/);
  assert.match(hostinger, /10\.253\.47\.2\/32/);
  assert.match(hostinger, /PersistentKeepalive = 25/);
  assert.match(hostinger, /postgres_started=false/);
  assert.match(hostinger, /runtime_started=false/);
});

test('Hostinger can roll back the former standby address transactionally', () => {
  assert.match(realign, /realign_hostinger_standby_wireguard_from_do_writer/);
  assert.match(realign, /old_address='10\.253\.47\.2\/30'/);
  assert.match(realign, /local_address='10\.253\.47\.1\/30'/);
  assert.match(realign, /cp -a "\$config_path" "\$backup_conf"/);
  assert.match(realign, /trap rollback ERR/);
  assert.match(realign, /systemctl stop "\$service"/);
  assert.match(realign, /systemctl start "\$service"/);
});

test('DO preserves its promoted address and permits a clean no-peer state', () => {
  assert.match(writer, /expected_address='10\.253\.47\.2\/30'/);
  assert.match(writer, /expected_allowed_ip='10\.253\.47\.1\/32'/);
  assert.match(writer, /unexpected_writer_peer_count/);
  assert.match(writer, /old_peer="\$\{old_peers\[0\]:-\}"/);
  assert.match(writer, /if \[ -n "\$old_peer" \]; then/);
  assert.match(writer, /wg set "\$interface" peer "\$new_peer_key" allowed-ips/);
  assert.match(writer, /postgres_changed=false/);
  assert.match(writer, /storage_changed=false/);
  assert.match(writer, /runtime_changed=false/);
});
