import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
import { runBootstrap, SOURCE_PATH, CRON } from './lemtel-cloudflare-arbiter-bootstrap-operator.mjs';
import { createSerializerBinding } from './lemtel-serializer-test-helpers.mjs';

// Synthetic, offline simulation of Cloudflare, DigitalOcean, the Keychain and the Hostinger agent sink.
const source = readFileSync(SOURCE_PATH);
const ACCOUNT = 'a'.repeat(32), DROPLET = '605469967', ORIGIN = 'https://lemtel-failover-arbiter.example.workers.dev';
const remoteScript = join(mkdtempSync(join(tmpdir(), 'lemtel-op-')), 'configure.sh');
writeFileSync(remoteScript, 'echo configure\n');

function world({ mode = 'disabled', revision = 'lemtel-failover-v1', failBootstrapPost = false, keychainFails = false, agentFails = false } = {}) {
  const kv = new Map();
  const STATE = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); } };
  const serializer = createSerializerBinding();
  const w = { kv, calls: [], sinks: [], schedules: ['*/5 * * * *'], pending: null,
    bindings: { STATE: { type: 'kv_namespace', value: STATE }, ARBITER_SERIALIZER: { type: 'durable_object_namespace', value: serializer.binding },
      FAILOVER_MODE: { type: 'plain_text', value: mode }, CONFIG_REVISION: { type: 'plain_text', value: revision } } };
  w.env = () => Object.fromEntries(Object.entries(w.bindings).map(([k, b]) => [k, b.value]));
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  w.fetch = async (url, init = {}) => {
    w.calls.push({ url, method: init.method || 'GET' });
    assert.equal(init.redirect, 'error');
    if (url === `https://api.digitalocean.com/v2/droplets/${DROPLET}`) return new Response(JSON.stringify({ droplet: { id: Number(DROPLET), status: 'active' } }), { status: 200 });
    const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/lemtel-failover-arbiter`;
    if (url === `${base}/settings`) return ok({ bindings: Object.entries(w.bindings).map(([name, b]) => ({ name, type: b.type,
      ...(b.type === 'plain_text' ? { text: b.value } : {}), ...(b.type === 'durable_object_namespace' ? { class_name: 'LemtelFailoverSerializer' } : {}) })) });
    if (url === `${base}/schedules`) {
      if (init.method === 'PUT') w.schedules = JSON.parse(init.body).map((s) => s.cron);
      return ok({ schedules: w.schedules.map((cron) => ({ cron })) });
    }
    if (url === `${base}/versions?bindings_inherit=strict`) {
      const metadata = JSON.parse(await init.body.get('metadata').text());
      assert.equal(createHash('sha256').update(Buffer.from(await init.body.get('lemtel-failover-arbiter-worker.mjs').arrayBuffer())).digest('hex'),
        createHash('sha256').update(source).digest('hex'));
      const next = {};
      for (const b of metadata.bindings) {
        if (b.type === 'inherit') { assert.ok(w.bindings[b.name], `strict inherit ${b.name}`); next[b.name] = w.bindings[b.name]; }
        else next[b.name] = { type: b.type, value: b.text };
      }
      w.pending = next;
      return ok({ id: '11111111-2222-3333-4444-555555555555' });
    }
    if (url === `${base}/deployments`) { w.bindings = w.pending; return ok({ id: 'd' }); }
    if (url.startsWith(ORIGIN)) {
      if (failBootstrapPost && init.method === 'POST') return new Response('{}', { status: 409 });
      return worker.fetch(new Request(url, { method: init.method || 'GET', headers: init.headers, body: init.body }), w.env());
    }
    throw new Error(`unexpected ${url}`);
  };
  w.spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let input = '';
    child.stdin = { end(data) { input = data; setImmediate(() => {
      w.sinks.push({ command, args, input });
      let out = '', code = 0;
      if (command === '/usr/bin/security') { out = input.startsWith('find') ? 'keychain: "login"\n' : ''; code = keychainFails ? 1 : 0; }
      else { out = agentFails ? 'agent_config_status=failed\n' : 'agent_config_status=complete\n'; }
      child.stdout.emit('data', out); child.emit('close', code);
    }); } };
    return child;
  };
  return w;
}
const env = (overrides = {}) => ({ LEMTEL_CF_BOOTSTRAP_INTENT: 'LEMTEL_CF_BOOTSTRAP_SEALED_CONFIG_V1', LEMTEL_CF_TARGET_ACCOUNT_ID: ACCOUNT,
  LEMTEL_CF_EXPECTED_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'), LEMTEL_CF_COMPATIBILITY_DATE: '2026-10-16',
  LEMTEL_CF_CONFIG_REVISION: 'lemtel-failover-20261019a', LEMTEL_DO_WRITER_DROPLET_ID: DROPLET, LEMTEL_ARBITER_ORIGIN: ORIGIN,
  CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token-xxxxxxxx', LEMTEL_DO_ARBITER_TOKEN: `synthetic-do-${'x'.repeat(40)}`,
  LEMTEL_AGENT_CONFIG_CMD: JSON.stringify(['/usr/bin/ssh', 'root@standby', '/bin/bash -s']), LEMTEL_DRILL_SECRET_CMD: JSON.stringify(['/usr/bin/security', '-i']),
  LEMTEL_AGENT_CONFIG_REMOTE_SCRIPT: remoteScript, ...overrides });
const run = (w, e = env()) => runBootstrap({ env: e, fetchImpl: w.fetch, spawnImpl: w.spawn, sleep: async () => {} });

test('injects a sealed configuration the real Worker accepts, returns to disabled, and configures the agent once', async () => {
  const w = world();
  const result = await run(w);
  assert.equal(result.state, 'complete');
  assert.equal(w.bindings.FAILOVER_MODE.value, 'disabled');
  assert.equal(w.bindings.CONFIG_REVISION.value, 'lemtel-failover-20261019a');
  assert.deepEqual(Object.keys(w.bindings).sort(), ['ARBITER_SERIALIZER', 'CONFIG_REVISION', 'CONFIG_STATE_ENCRYPTION_KEY', 'FAILOVER_MODE', 'STATE']);
  assert.deepEqual(w.schedules, [CRON]);
  assert.ok(w.kv.has('lemtel_failover_execution_v1:sealed-config:lemtel-failover-20261019a'));
  // Switching to active (later, separately) decrypts the configuration: it is the drill gate that blocks, not the config.
  const status = await (await worker.fetch(new Request(`${ORIGIN}/status`), { ...w.env(), FAILOVER_MODE: 'active' })).json();
  assert.equal(status.reason, 'production_drill_or_serialization_not_verified');
  // Secrets: drill secret only to the Keychain, agent secret only to the agent sink, nothing in clear in KV.
  const keychain = w.sinks.find((s) => s.command === '/usr/bin/security' && s.input.startsWith('add'));
  const drill = keychain.input.match(/-w ([A-Za-z0-9_-]{43})\n$/u)[1];
  const agent = w.sinks.find((s) => s.command === '/usr/bin/ssh');
  const agentSecret = agent.input.match(/AGENT_SHARED_SECRET=([A-Za-z0-9_-]{43})/u)[1];
  assert.match(agent.input, /^echo configure\nFAILOVER_MODE=active\nARBITER_URL=https:\/\/lemtel-failover-arbiter\.example\.workers\.dev\n/u);
  assert.match(agent.input, /PROMOTION_EXECUTION_MODE=review\n$/u);
  assert.ok(!agent.input.includes(drill) && !keychain.input.includes(agentSecret));
  for (const value of w.kv.values()) for (const s of [drill, agentSecret, env().LEMTEL_DO_ARBITER_TOKEN]) assert.ok(!value.includes(s));
  // Bootstrap mode was entered and left; the worker never ran active.
  const posts = w.calls.filter((c) => c.url.startsWith(ORIGIN) && c.method === 'POST');
  assert.equal(posts.length, 1);
});

test('refuses before any change when the arbiter is not disabled or the revision is not new', async () => {
  for (const [options, reason] of [[{ mode: 'active' }, 'remote_mode_not_disabled'], [{ revision: 'lemtel-failover-20261019a' }, 'config_revision_must_be_new']]) {
    const w = world(options);
    await assert.rejects(run(w), (e) => e.code === reason);
    assert.ok(!w.calls.some((c) => c.method !== 'GET'), 'no write');
    assert.equal(w.sinks.length, 0);
  }
});

test('a Keychain failure stops before any Cloudflare change to the Worker', async () => {
  const w = world({ keychainFails: true });
  await assert.rejects(run(w), (e) => e.code === 'drill_secret_keychain_failed');
  assert.ok(!w.calls.some((c) => c.url.includes('/versions') || c.url.includes('/deployments')));
  assert.equal(w.bindings.FAILOVER_MODE.value, 'disabled');
});

test('a refused injection still returns the Worker to disabled and never configures the agent', async () => {
  const w = world({ failBootstrapPost: true });
  await assert.rejects(run(w));
  assert.equal(w.bindings.FAILOVER_MODE.value, 'disabled');
  assert.ok(!w.sinks.some((s) => s.command === '/usr/bin/ssh'));
});

test('invalid gates never reach the network', async () => {
  for (const override of [{ LEMTEL_CF_BOOTSTRAP_INTENT: 'x' }, { LEMTEL_ARBITER_ORIGIN: 'https://evil.example.com' },
    { LEMTEL_CF_CONFIG_REVISION: 'BAD' }, { LEMTEL_DO_ARBITER_TOKEN: 'short' }, { LEMTEL_CF_EXPECTED_SOURCE_SHA256: 'b'.repeat(64) }]) {
    const w = world();
    await assert.rejects(run(w, env(override)));
    assert.equal(w.calls.length, 0, JSON.stringify(override));
  }
});
