import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/arbiter/lemtel-failover-arbiter.mjs'), 'utf8');
const contract = JSON.parse(readFileSync(resolve(root, 'infra/lemtel-resilience/arbiter/contract.json'), 'utf8'));

test('arbiter bootstrap is Cloudflare-hosted and deny-by-default', () => {
  assert.equal(contract.hosting, 'cloudflare_workers_independent_of_digitalocean_and_hostinger');
  assert.equal(contract.mode, 'deny_by_default_bootstrap');
  assert.equal(contract.provider_action, false);
  assert.equal(contract.fencing, false);
  assert.equal(contract.promotion, false);
  assert.equal(contract.cloudflare_traffic_routing, false);
  assert.equal(contract.telephony, false);
});

test('arbiter exposes only redacted static status and cannot control infrastructure', () => {
  for (const expected of ['automatic_fencing_enabled: false', 'automatic_promotion_enabled: false', 'automatic_traffic_failover_enabled: false', "decision: 'deny'", "path === '/healthz'"]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /\b(?:await\s+fetch|DROPLET|TOKEN|SECRET|pg_promote|power_off|shutdown|load_balancer|pool|monitor)\b/i);
});
