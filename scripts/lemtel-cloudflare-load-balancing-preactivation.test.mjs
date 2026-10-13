import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const contract = () => JSON.parse(read('infra/lemtel-resilience/active-passive/cloudflare-load-balancing-preactivation-contract.json'));

test('Cloudflare Load Balancing is subscribed but not configured or routed', () => {
  const value = contract();
  assert.equal(value.scope, 'design_and_validation_only_no_cloudflare_mutation');
  assert.equal(value.subscription.load_balancing_subscription_active, true);
  assert.equal(value.subscription.load_balancer_resource_configured, false);
  assert.equal(value.subscription.pools_configured, false);
  assert.equal(value.subscription.monitor_configured, false);
  assert.equal(value.subscription.canonical_routing_changed, false);
});

test('the planned topology remains priority active-passive and cannot route the standby early', () => {
  const value = contract();
  assert.equal(value.topology.strategy, 'priority_active_passive');
  assert.equal(value.topology.primary_pool_role, 'digitalocean_current_writer_only');
  assert.equal(value.topology.fallback_pool_role, 'hostinger_promoted_writer_only');
  assert.equal(value.topology.fallback_pool_enabled_before_verified_promotion, false);
  assert.equal(value.topology.session_affinity_claimed, false);
});

test('writer-ready monitoring requires promotion safety rather than generic HTTPS reachability', () => {
  const value = contract();
  assert.equal(value.writer_ready_monitor.protocol, 'https');
  assert.equal(value.writer_ready_monitor.expected_status, 200);
  assert.match(value.writer_ready_monitor.path_contract, /redacted/i);
  assert.deepEqual(value.writer_ready_monitor.must_require, [
    'single_postgresql_writer',
    'runtime_ready',
    'immutable_artifact_digest_verified',
    'storage_freshness_verified',
    'promotion_authorization_when_standby'
  ]);
  assert.deepEqual(value.writer_ready_monitor.must_not_expose, [
    'server_address',
    'provider_identifier',
    'database_state_detail',
    'secret',
    'customer_data'
  ]);
});

test('all automatic-routing gates remain incomplete and protective boundaries hold', () => {
  const value = contract();
  assert.deepEqual(value.activation_gates, {
    independent_arbiter_deployed: false,
    provider_fencing_drill_verified: false,
    postgres_synchronous_streaming_verified: false,
    storage_dual_durable_write_verified: false,
    hostinger_runtime_promotion_guard_verified: false,
    final_routing_window_approved: false
  });
  assert.equal(value.boundaries.cloudflare_monitor_must_not_promote_postgres, true);
  assert.equal(value.boundaries.cloudflare_monitor_must_not_start_hostinger_runtime, true);
  assert.equal(value.boundaries.no_automatic_route_before_all_gates, true);
  assert.equal(value.boundaries.no_public_postgres, true);
  assert.equal(value.boundaries.no_telephony_change, true);
  assert.equal(value.boundaries.no_planipret_change, true);
});

test('preactivation guide contains no infrastructure identifiers or credential material', () => {
  const guide = read('infra/lemtel-resilience/active-passive/CLOUDFLARE_LOAD_BALANCING_PREACTIVATION.md');
  assert.match(guide, /aucun Load Balancer créé/i);
  assert.match(guide, /Cloudflare ne promeut jamais PostgreSQL/i);
  assert.match(guide, /Hostinger après promotion/i);
  assert.doesNotMatch(guide, /\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  assert.doesNotMatch(guide, /(?:api[_ -]?key|bearer\s+[a-z0-9]|token\s*[:=]\s*[^\s])/iu);
});
