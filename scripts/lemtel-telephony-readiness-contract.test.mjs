import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(`./${path}`, root), 'utf8');
const contract = JSON.parse(read('infra/lemtel-self-hosted/telephony/provisioning-readiness-contract.json'));
const preflight = read('infra/lemtel-self-hosted/telephony/lemtel-telephony-readiness-preflight.sh');
const guide = read('docs/lemtel-telephony/ACTIVATION_READINESS.md');

test('telephony readiness stays fail-closed until independently authorized', () => {
  assert.equal(contract.telephony_enabled, false);
  assert.equal(contract.activation_authorized, false);
  assert.equal(contract.automatic_failover_enabled, false);
  assert.equal(contract.topology.writer, 'digitalocean_only');
  assert.equal(contract.topology.standby, 'hostinger_passive_only');
  assert.equal(contract.secret_handling.emit_secret_values, false);
  for (const action of ['pbx_connection', 'sip_registration', 'wss_endpoint_exposure', 'turn_credential_delivery', 'provider_write', 'dns_change', 'hostinger_runtime_start', 'automatic_promotion']) {
    assert.ok(contract.forbidden_actions_before_activation.includes(action));
  }
});

test('readiness preflight is root-gated, redacted and cannot contact or configure a provider', () => {
  for (const expected of ['[ "$(id -u)" -eq 0 ]', 'LEMTEL_HA_ROLE:-', 'digitalocean_writer', 'credential_values_emitted=false', 'provider_contacted=false', 'provider_write_executed=false', 'sip_registration_attempted=false', 'dns_change_executed=false', 'hostinger_contacted=false']) {
    assert.match(preflight, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(preflight, /\b(?:curl|wget|nc|ssh|scp|rsync|doctl|hcloud)\b/i);
  assert.doesNotMatch(preflight, /printf[^\n]*(?:\$\{?LEMTEL_TELEPHONY|\$\{?SUPABASE_SERVICE_ROLE_KEY|\$\{?RESEND_API_KEY)/i);
});

test('activation guide requires secure intake, proof on physical devices and rollback', () => {
  for (const expected of ['canal secret contrôlé', 'Desktop, iPhone et Android', 'tests négatifs', 'rollback', 'DigitalOcean demeure le seul writer/runtime public']) {
    assert.match(guide, new RegExp(expected, 'i'));
  }
  assert.doesNotMatch(guide, /automatic_failover_enabled=true|promote Hostinger|enable PBX now/i);
});
