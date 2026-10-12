import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-wireguard-ingress-enable.sh'), 'utf8');

test('writer ingress remediation requires explicit root authority and an exact writer role', () => {
  assert.match(source, /root_required/);
  assert.match(source, /enable_hostinger_standby_wireguard_ingress_on_do_writer/);
  assert.match(source, /digitalocean_writer/);
  assert.match(source, /invalid_hostinger_standby_public_ip/);
});

test('writer ingress remediation opens only the Hostinger UDP source rule', () => {
  assert.match(source, /ufw allow from "\$standby_public_ip" to any port "\$listen_port" proto udp/);
  assert.match(source, /Lemtel HA Hostinger standby/);
  assert.doesNotMatch(source, /ufw allow\s+\d/);
  assert.doesNotMatch(source, /0\.0\.0\.0/);
  assert.doesNotMatch(source, /allow\s+51820\/udp/);
});

test('writer ingress remediation rolls back a newly-added rule when handshake verification fails', () => {
  assert.match(source, /firewall_added=false/);
  assert.match(source, /trap rollback EXIT/);
  assert.match(source, /ufw --force delete allow from "\$standby_public_ip" to any port "\$listen_port" proto udp/);
  assert.match(source, /\/proc\/net\/udp/);
  assert.match(source, /port_hex="\$\(printf '%04X' "\$listen_port"\)"/);
  assert.match(source, /hostinger_handshake_missing/);
  assert.match(source, /wireguard_handshake_verified=true/);
});

test('writer ingress remediation cannot touch application or telephony surfaces', () => {
  for (const assertion of ['database_changed=false', 'storage_changed=false', 'runtime_changed=false', 'dns_changed=false', 'automatic_promotion_enabled=false', 'fusionpbx_or_sip_contacted=false', 'credential_values_emitted=false']) {
    assert.match(source, new RegExp(assertion));
  }
  assert.doesNotMatch(source, /docker compose/);
  assert.doesNotMatch(source, /pg_basebackup/);
});
