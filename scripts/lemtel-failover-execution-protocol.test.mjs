import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import worker from '../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
import { createBootstrapSession, createBootstrapEnvelope, canonical, protocol }
  from '../infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs';
import { createSerializerBinding } from './lemtel-serializer-test-helpers.mjs';

// All endpoints, credentials and numeric bindings below are synthetic fixtures.
// global fetch is replaced in every behavioral test: no network access is possible.
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'infra/lemtel-resilience/automatic-failover');
const read = (name) => readFileSync(resolve(dir, name), 'utf8');
const workerSource = read('lemtel-failover-arbiter-worker.mjs');
const agent = read('lemtel-ha-hostinger-failover-agent.sh');
const service = read('lemtel-ha-hostinger-failover-agent.service');
const timer = read('lemtel-ha-hostinger-failover-agent.timer');
const prefix = 'lemtel_failover_execution_v1';
const incidentKey = `${prefix}:incident`;
const statusKey = `${prefix}:status`;
const drillKey = `${prefix}:production-drill`;
const readinessKey = `${prefix}:standby-readiness`;
const fakeURL = (name) => `https://${[name, 'test', 'invalid'].join('.')}`;
const writerID = '7'.repeat(9);
const secret = (name) => `synthetic-${name}-${'x'.repeat(48)}`;
const sessionPromise = createBootstrapSession('synthetic-config-v1');
const decode = (value) => Buffer.from(value, 'base64url');
const encode = (context, value) => new TextEncoder().encode(`${context}\n${canonical(value)}`);
function signature(key, context, payload) {
  return createHmac('sha256', key).update(`${context}\n${canonical(payload)}`).digest('hex');
}
function response(body, code = 200) {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}
async function fixture(t) {
  const session = await sessionPromise;
  const values = new Map();
  const f = { now: Math.floor(Date.UTC(2030, 0, 1) / 1000), values, calls: [],
    health: 'unhealthy', power: 'active', actionStatus: 'in-progress', actionType: 'shutdown',
    actionID: 11, failPost: false, failPoll: false, failIntent: false };
  const aes = await crypto.subtle.importKey('raw', decode(session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY),
    'AES-GCM', false, ['encrypt', 'decrypt']);
  f.open = async (raw) => {
    const { iv, ciphertext, ...metadata } = JSON.parse(raw);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: decode(iv), tagLength: 128, additionalData: encode(protocol.stateContext, metadata) }, aes, decode(ciphertext))));
  };
  f.seal = async (kind, payload) => {
    const metadata = { format: 'lemtel_failover_sealed_state_v1', version: 1, algorithm: 'AES-256-GCM', kind,
      config_revision: f.env.CONFIG_REVISION, issued_at: f.now, expires_at: f.now + 3600 };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
      additionalData: encode(protocol.stateContext, metadata) }, aes, new TextEncoder().encode(JSON.stringify(payload)));
    return JSON.stringify({ ...metadata, iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') });
  };
  const STATE = {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) {
      if (f.failIntent && key === incidentKey && (await f.open(value)).phase === 'fence_graceful_shutdown_requested') throw new Error('synthetic_kv_failure');
      if (f.failDispatchPersist && key === incidentKey && (await f.open(value)).phase === 'promotion_command_dispatched') throw new Error('synthetic_kv_failure');
      values.set(key, value);
    },
  };
  f.configuration = { DO_API_TOKEN: secret('provider'),
    DO_WRITER_DROPLET_ID: writerID, AGENT_SHARED_SECRET: secret('agent'),
    DO_WRITER_L7_SECRET: secret('l7'), DRILL_APPROVAL_SECRET: secret('approval'),
    DO_API_BASE_URL: `${fakeURL('provider')}/v2`, DO_WRITER_L7_URL: `${fakeURL('writer')}/lemtel-lb-ready`,
    OBSERVATION_INTERVAL_SECONDS: '60', INCIDENT_FAILURE_CYCLES: '3',
    GRACEFUL_SHUTDOWN_DELAY_SECONDS: '180', POWER_STATE_TIMEOUT_SECONDS: '1800', COMMAND_TTL_SECONDS: '120' };
  f.serializer = createSerializerBinding();
  f.env = { FAILOVER_MODE: 'bootstrap', STATE, ...session.textBindings, ...session.secretBindings };
  const descriptor = await (await worker.fetch(new Request(fakeURL('arbiter') + protocol.keyPath), f.env)).json();
  const injection = await createBootstrapEnvelope({ session, publicDescriptor: descriptor, configuration: f.configuration, now: f.now });
  t.mock.method(Date, 'now', () => f.now * 1000);
  assert.equal((await worker.fetch(new Request(fakeURL('arbiter') + protocol.bootstrapPath, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lemtel-bootstrap-proof': injection.proof },
    body: JSON.stringify(injection.envelope) }), f.env)).status, 201);
  f.env = { FAILOVER_MODE: 'active', STATE, ARBITER_SERIALIZER: f.serializer.binding, CONFIG_REVISION: session.configRevision,
    CONFIG_STATE_ENCRYPTION_KEY: session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY };
  f.setConfig = async () => values.set(`${prefix}:sealed-config:${f.env.CONFIG_REVISION}`, await f.seal('configuration',
    { format: 'lemtel_failover_protected_config_v1', config_revision: f.env.CONFIG_REVISION,
      issued_at: f.now, expires_at: f.now + 3600, configuration: f.configuration }));
  f.setIncident = async (payload) => values.set(incidentKey, await f.seal('incident', payload));
  f.setDrill = async (payload) => values.set(drillKey, await f.seal('drill', payload));
  f.autoReady = true;
  f.readinessPayload = (overrides = {}) => ({ format: 'lemtel_standby_readiness_v1', target_role: 'hostinger_standby',
    observed_at: f.now, ready: true, standby_in_recovery: true, runtime_stage_present: true, ...overrides });
  f.setReadiness = async (payload = f.readinessPayload()) => values.set(readinessKey, await f.seal('readiness', payload));
  f.readinessHeader = (payload = f.readinessPayload(), key = f.configuration.AGENT_SHARED_SECRET) =>
    Buffer.from(JSON.stringify({ payload, signature: signature(key, 'lemtel-standby-readiness-v1', payload) })).toString('base64url');
  const readyMarker = (observedAt = f.now) => ({ format: 'lemtel_do_writer_l7_ready_v1', writer_role: 'do_writer',
    definitive: true, observed_at: observedAt, status: 'healthy' });
  const l7Response = (body, code = 200, url = f.configuration.DO_WRITER_L7_URL, redirected = false) => {
    const raw = response(body, code);
    return { status: raw.status, headers: raw.headers, body: raw.body, url, redirected };
  };
  const l7TextResponse = (body, code = 200, url = f.configuration.DO_WRITER_L7_URL) => {
    const raw = new Response(body, { status: code, headers: { 'content-type': 'application/json' } });
    return { status: raw.status, headers: raw.headers, body: raw.body, url, redirected: false };
  };
  const cloudflareEdge = (code, ray, url = f.configuration.DO_WRITER_L7_URL) => {
    const raw = new Response('<html>origin error</html>', { status: code,
      headers: { 'content-type': 'text/html', ...(ray ? { 'cf-ray': ray } : {}) } });
    return { status: raw.status, headers: raw.headers, body: raw.body, url, redirected: false };
  };
  const l7EmptyResponse = (code = 404, url = f.configuration.DO_WRITER_L7_URL) => {
    const raw = new Response(null, { status: code });
    return { status: raw.status, headers: raw.headers, body: raw.body, url, redirected: false };
  };
  const payload = { format: 'lemtel_production_destructive_drill_v1', config_revision: f.env.CONFIG_REVISION,
    writer_role: 'do_writer', target_role: 'hostinger_standby', writer_droplet_id: writerID,
    destructive_drill_validated: true, serialized_execution_verified: true,
    validated_at: f.now - 60, expires_at: f.now + 3600 };
  await f.setDrill({ payload, signature: signature(f.configuration.DRILL_APPROVAL_SECRET, 'lemtel-production-drill-v1', payload) });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    f.calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url === f.configuration.DO_WRITER_L7_URL) {
      if (f.healthBarrier) await f.healthBarrier;
      if (f.health === 'timeout') throw new Error('synthetic_transport_failure');
      if (f.health === 'unhealthy') return l7EmptyResponse();
      if (f.health === 'invalid') return l7Response({ arbitrary: true });
      if (f.health === 'enriched') return l7Response({ ...readyMarker(), reason: 'unexpected' });
      if (f.health === 'non_json') return l7TextResponse('not-json');
      if (f.health === 'stale') return l7Response(readyMarker(f.now - 121));
      if (f.health === 'arbitrary_5xx') return l7Response({ error: 'opaque' }, 503);
      if (f.health === 'wrong_host') return l7EmptyResponse(404, `${fakeURL('other-writer')}/lemtel-lb-ready`);
      if (f.health === 'wrong_path') return l7EmptyResponse(404, `${fakeURL('writer')}/unexpected`);
      if (f.health === 'redirect') return l7Response(readyMarker(), 200, f.configuration.DO_WRITER_L7_URL, true);
      if (f.health === 'origin_down') return cloudflareEdge(522, '8c1f0e2d3a4b5c6d-YUL');
      if (f.health === 'origin_down_521') return cloudflareEdge(521, '8c1f0e2d3a4b5c6d-YYZ');
      if (f.health === 'origin_down_no_ray') return cloudflareEdge(522, null);
      if (f.health === 'edge_524') return cloudflareEdge(524, '8c1f0e2d3a4b5c6d-YUL');
      return l7Response(readyMarker());
    }
    assert.ok(url.startsWith(`${f.configuration.DO_API_BASE_URL}/`), 'only the configured fake provider can be requested');
    if (options.method === 'POST') {
      assert.equal((await f.incident()).phase,
        JSON.parse(options.body).type === 'shutdown' ? 'fence_graceful_shutdown_requested' : 'fence_hard_power_off_requested');
      if (f.failPost) throw new Error('synthetic_unknown_post_outcome');
      f.actionType = JSON.parse(options.body).type;
      f.actionID += 1;
      return response({ action: { id: f.actionID, type: f.actionType, resource_id: Number(writerID),
        resource_type: 'droplet', status: f.actionStatus } }, 201);
    }
    if (f.failPoll) throw new Error('synthetic_unknown_power_state');
    if (url.endsWith(`/actions/${f.actionID}`)) return response({ action: { id: f.actionID, type: f.actionType,
      resource_id: Number(writerID), resource_type: 'droplet', status: f.actionStatus } });
    assert.equal(url, `${f.configuration.DO_API_BASE_URL}/droplets/${writerID}`);
    return response({ droplet: { id: Number(writerID), status: f.power } });
  });
  f.tick = async (advance = 60) => {
    f.now += advance;
    if (f.autoReady) await f.setReadiness();
    let waited;
    const result = await worker.scheduled({}, f.env, { waitUntil(task) { waited = task; } });
    assert.ok(waited instanceof Promise);
    await waited;
    return result;
  };
  f.incident = async () => values.has(incidentKey) ? f.open(values.get(incidentKey)) : null;
  f.posts = () => f.calls.filter((call) => call.options.method === 'POST').map((call) => JSON.parse(call.options.body).type);
  f.get = (path, authorized = false) => worker.fetch(new Request(fakeURL('arbiter') + path,
    { headers: authorized === true ? { authorization: `Bearer ${f.configuration.AGENT_SHARED_SECRET}` }
      : typeof authorized === 'string' ? { authorization: authorized } : {} }), f.env);
  return f;
}
async function suspicion(f) {
  assert.equal((await f.tick()).state, 'incident_suspected');
  assert.equal((await f.tick()).state, 'incident_suspected');
  assert.deepEqual(f.posts(), []);
  assert.equal((await f.tick()).state, 'fence_wait_graceful');
  assert.deepEqual(f.posts(), ['shutdown']);
}
async function gracefulCommand(f) {
  await suspicion(f);
  f.power = 'off'; f.actionStatus = 'completed';
  assert.equal((await f.tick()).state, 'fence_poll_terminal');
  assert.equal((await f.tick()).state, 'fence_verified');
  assert.equal((await f.tick()).state, 'promotion_command_ready');
}

test('default export exposes fetch and scheduled, with no imports or real endpoint/secret/ID in prepared artifacts', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
  assert.doesNotMatch(workerSource, /^\s*import\s/m);
  for (const text of [workerSource, agent, service, timer]) {
    assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b|https?:\/\/[^\s'"`]+|\b(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
    assert.doesNotMatch(text, /(?:DO_WRITER_DROPLET_ID|DO_API_TOKEN|AGENT_SHARED_SECRET)\s*=\s*['"]?\d+/u);
  }
  assert.match(workerSource, /const ROUTING_ENABLED = false/u);
  assert.doesNotMatch(workerSource, /(?:load_balancers|dns_records|cloudflare\.com|\/zones\/|\/accounts\/)/u);
});

test('absent, disabled, dry-run and non-exact active mode never call health/provider or deliver commands', async (t) => {
  const f = await fixture(t);
  for (const mode of [undefined, 'disabled', 'dry_run', 'ACTIVE', 'active ']) {
    f.env.FAILOVER_MODE = mode;
    assert.equal((await f.tick()).state, 'disabled_or_dry_run');
    const result = await (await f.get('/agent/command', true)).json();
    assert.equal(result.state, 'disabled_or_dry_run');
    assert.equal(result.automatic_traffic_routing_enabled, false);
    assert.ok(!result.command);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.incident()), null);
  assert.equal(f.values.has(statusKey), false, 'disabled has no KV writes');
});

test('every explicit active binding, secret, ID, approval and safety limit is mandatory before any outbound call', async (t) => {
  const f = await fixture(t);
  for (const key of Object.keys(f.env).filter((key) => key !== 'FAILOVER_MODE')) {
    const saved = f.env[key]; delete f.env[key];
    assert.equal((await f.tick()).state, 'blocked', key);
    const res = await f.get('/agent/command', true);
    assert.equal(res.status, 404, key);
    assert.ok(!(await res.json()).command);
    f.env[key] = saved;
  }
  for (const key of Object.keys(f.configuration)) {
    const saved = f.configuration[key]; delete f.configuration[key];
    await f.setConfig();
    assert.equal((await f.tick()).state, 'blocked', key);
    assert.equal((await f.get('/agent/command', true)).status, 404, key);
    f.configuration[key] = saved;
  }
  await f.setConfig();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.incident()), null);
});

test('missing or invalid Durable Object binding blocks before health/provider fetch or a command', async (t) => {
  const f = await fixture(t);
  delete f.env.ARBITER_SERIALIZER;
  let result = await f.tick();
  assert.equal(result.reason, 'serializer_lease_unavailable');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.serializer.calls, []);
  f.env.ARBITER_SERIALIZER = { idFromName() { throw new Error('synthetic_invalid_binding'); }, get() {} };
  result = await f.tick();
  assert.equal(result.reason, 'serializer_lease_unavailable');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.serializer.calls, []);
  assert.equal((await f.get('/agent/command', true)).status, 404);
});

test('L7 configuration is pinned to the exact HTTPS readiness path before any observation', async (t) => {
  const f = await fixture(t);
  f.configuration.DO_WRITER_L7_URL = `${fakeURL('writer')}/unexpected`;
  await f.setConfig();
  assert.equal((await f.tick()).state, 'blocked');
  assert.equal(f.calls.length, 0);
});

test('unsigned, expired, missing or config-mismatched production drill is fail-closed', async (t) => {
  const f = await fixture(t), original = f.values.get(drillKey);
  for (const change of [null, { signature: '0'.repeat(64) }, { payload: { expires_at: f.now - 1 } },
    { payload: { config_revision: 'wrong-revision' } }, { payload: { serialized_execution_verified: false } }]) {
    if (change === null) f.values.delete(drillKey);
    else {
      const receipt = await f.open(original);
      if (change.payload) Object.assign(receipt.payload, change.payload);
      if (change.signature) receipt.signature = change.signature;
      else receipt.signature = signature(f.configuration.DRILL_APPROVAL_SECRET, 'lemtel-production-drill-v1', receipt.payload);
      await f.setDrill(receipt);
    }
    assert.equal((await f.tick()).state, 'blocked');
  }
  assert.equal(f.calls.length, 0);
});

test('exact 404 marker absence is definitive unhealthy and exact healthy JSON resets suspicion', async (t) => {
  const f = await fixture(t);
  const unavailable = await f.tick();
  assert.equal(unavailable.state, 'incident_suspected');
  assert.equal((await f.incident()).last_definitive_observation, 'unhealthy');
  assert.equal((await f.incident()).failure_cycles, 1);
  f.health = 'healthy';
  const healthy = await f.tick();
  assert.equal(healthy.state, 'healthy');
  assert.equal((await f.incident()).last_definitive_observation, 'healthy');
  assert.equal((await f.incident()).failure_cycles, 0);
  assert.deepEqual(f.posts(), []);
});

test('only the exact healthy JSON is positive; ambiguous L7 responses reset suspicion and never fence', async (t) => {
  const f = await fixture(t);
  for (const health of ['healthy', 'timeout', 'invalid', 'enriched', 'non_json', 'stale', 'arbitrary_5xx', 'wrong_host', 'wrong_path', 'redirect']) {
    f.health = 'unhealthy'; await f.tick(); await f.tick();
    f.health = health;
    const result = await f.tick();
    assert.equal(result.state, health === 'healthy' ? 'healthy' : 'blocked');
    assert.equal((await f.incident()).failure_cycles, 0);
    assert.equal((await f.incident()).phase, 'observation');
  }
  assert.deepEqual(f.posts(), []);
});

test('duplicate scheduler attempts during a live lease fail closed and do not manufacture failures', async (t) => {
  const f = await fixture(t);
  await f.tick();
  assert.equal((await f.tick(0)).reason, 'serializer_lease_unavailable');
  assert.equal((await f.tick(1)).reason, 'serializer_lease_unavailable');
  assert.equal((await f.incident()).failure_cycles, 1);
  assert.deepEqual(f.posts(), []);
});

test('graceful shutdown, delay, hard power_off, repeated terminal poll, signed fence and expiring promotion command', async (t) => {
  const f = await fixture(t);
  await suspicion(f);
  await f.tick(); await f.tick();
  assert.deepEqual(f.posts(), ['shutdown']);
  assert.equal((await f.tick()).state, 'fence_wait_hard');
  assert.deepEqual(f.posts(), ['shutdown', 'power_off']);
  f.power = 'off'; f.actionStatus = 'completed';
  assert.equal((await f.tick()).state, 'fence_poll_terminal');
  assert.equal((await f.tick()).state, 'fence_verified');
  assert.equal((await f.incident()).command, undefined);
  assert.equal((await f.tick()).state, 'promotion_command_ready');
  for (const value of f.values.values()) {
    for (const name of ['DO_API_TOKEN', 'AGENT_SHARED_SECRET', 'DO_WRITER_L7_SECRET', 'DRILL_APPROVAL_SECRET',
      'DO_WRITER_DROPLET_ID', 'DO_API_BASE_URL', 'DO_WRITER_L7_URL']) {
      assert.ok(!value.includes(f.configuration[name]), 'KV contains ciphertext, never operational configuration values');
      assert.ok(!value.includes(name), 'KV has no clear operational field names');
    }
  }
  const publicStatus = await (await f.get('/status')).json();
  assert.equal(publicStatus.automatic_promotion_enabled, false);
  assert.equal(publicStatus.automatic_runtime_start_enabled, false);
  assert.equal(publicStatus.automatic_traffic_routing_enabled, false);
  assert.equal(publicStatus.command, undefined);
  assert.ok(!JSON.stringify(publicStatus).includes(writerID));
  // The mailbox refuses anonymous or wrongly authenticated callers without touching the incident.
  assert.equal((await f.get('/agent/command')).status, 401);
  assert.equal((await f.get('/agent/command', `Bearer ${secret('wrong-agent')}`)).status, 401);
  assert.equal((await f.get('/agent/command', f.configuration.AGENT_SHARED_SECRET)).status, 401);
  const prepared = await f.incident();
  assert.equal(prepared.phase, 'promotion_command_ready');
  assert.equal(prepared.command.payload.name, 'promotion');
  assert.equal(prepared.command.payload.target_role, 'hostinger_standby');
  assert.equal(prepared.command.payload.writer_role, 'do_writer');
  assert.equal(prepared.command.payload.expires_at - prepared.command.payload.issued_at, 120);
  assert.equal(prepared.command.signature, signature(f.configuration.AGENT_SHARED_SECRET, 'lemtel-promotion-command-v1', prepared.command.payload));
  assert.equal((await f.tick()).state, 'promotion_command_ready');
});

test('graceful terminal state needs no hard fence; expired command is not reissued', async (t) => {
  const f = await fixture(t);
  await gracefulCommand(f);
  assert.deepEqual(f.posts(), ['shutdown']);
  f.now += 121;
  const expired = await f.get('/agent/command', true);
  assert.equal(expired.status, 200);
  assert.deepEqual(await expired.json(), { state: 'no_command' });
  assert.equal((await f.incident()).phase, 'promotion_command_ready');
  assert.equal((await f.tick()).state, 'blocked');
  assert.equal((await f.incident()).phase, 'blocked');
  assert.deepEqual(f.posts(), ['shutdown']);
});

test('writer power returns active before receipt issuance: block, never sign a command', async (t) => {
  const f = await fixture(t);
  await suspicion(f); f.power = 'off'; f.actionStatus = 'completed';
  await f.tick(); await f.tick();
  f.power = 'active';
  const result = await f.tick();
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'terminal_power_state_changed');
  assert.equal((await f.incident()).command, undefined);
});

test('ambiguous provider polling never permits hard fence or a receipt', async (t) => {
  const f = await fixture(t);
  await suspicion(f); f.failPoll = true;
  assert.equal((await f.tick(180)).state, 'blocked');
  assert.equal((await f.tick()).state, 'blocked');
  assert.deepEqual(f.posts(), ['shutdown']);
  assert.equal((await f.incident()).command, undefined);
});

test('unknown destructive POST outcome is persisted and never retried', async (t) => {
  const f = await fixture(t); f.failPost = true;
  await f.tick(); await f.tick();
  assert.equal((await f.tick()).state, 'blocked');
  assert.equal((await f.tick()).state, 'blocked');
  assert.deepEqual(f.posts(), ['shutdown']);
  assert.equal((await f.incident()).command, undefined);
});

test('a failed intent write prevents a provider POST entirely', async (t) => {
  const f = await fixture(t); f.failIntent = true;
  await f.tick(); await f.tick();
  assert.equal((await f.tick()).state, 'blocked');
  assert.deepEqual(f.posts(), []);
});

test('a recovered destructive intent requires manual reconciliation, not a POST retry', async (t) => {
  const f = await fixture(t);
  await f.setIncident({ version: prefix, config_revision: f.env.CONFIG_REVISION,
    phase: 'fence_graceful_shutdown_requested', last_cycle_at: 0 });
  const result = await f.tick();
  assert.equal(result.reason, 'persisted_fence_intent_requires_manual_reconciliation');
  assert.equal(f.calls.length, 0);
});

test('HTTP never starts an incident: the mailbox is read-only without a prepared command and mutating methods are refused', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get('/status')).status, 200);
  const empty = await f.get('/agent/command', true);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { state: 'no_command' });
  assert.equal((await f.incident()), null);
  const res = await worker.fetch(new Request(fakeURL('arbiter') + '/agent/command', { method: 'POST' }), f.env);
  assert.equal(res.status, 405);
  assert.equal(f.calls.length, 0);
});

test('isolate overlap protection remains held while asynchronous observation is pending', async (t) => {
  const f = await fixture(t);
  let release;
  f.healthBarrier = new Promise((done) => { release = done; });
  const first = worker.scheduled({}, f.env);
  while (f.calls.length === 0) await new Promise((done) => setImmediate(done));
  const second = await worker.scheduled({}, f.env);
  assert.equal(second.reason, 'overlapping_tick');
  release(); await first;
  assert.equal((await f.incident()).failure_cycles, 1);
});

test('a second Worker module/isolate cannot acquire the singleton lease held by a scheduler', async (t) => {
  const f = await fixture(t);
  let release;
  f.healthBarrier = new Promise((done) => { release = done; });
  const first = worker.scheduled({}, f.env);
  while (f.calls.length === 0) await new Promise((done) => setImmediate(done));
  const cold = (await import(`../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs?cold=${crypto.randomUUID()}`)).default;
  const second = await cold.scheduled({}, f.env);
  assert.equal(second.reason, 'serializer_lease_unavailable');
  assert.equal(f.calls.length, 1, 'second isolate must not reach health/provider fetch');
  release();
  assert.equal((await first).state, 'incident_suspected');
});

test('agent root gates, one fixed config and isolated interpreter; preflight precedes remote poll', () => {
  assert.match(agent, /\[ "\$\(id -u\)" -eq 0 \] \|\| blocked root_required/u);
  assert.match(agent, /LEMTEL_HA_EXECUTE:-\}" = 'run_hostinger_failover_agent'/u);
  assert.match(agent, /LEMTEL_HA_ROLE:-\}" = 'hostinger_standby'/u);
  assert.match(agent, /\/usr\/bin\/python3 -I -/u);
  assert.match(agent, /CONFIG = '\/etc\/lemtel-ha\/failover-agent\.env'/u);
  assert.equal((agent.match(/open\(CONFIG/g) || []).length, 1);
  assert.match(agent, /secure_path\(CONFIG, 0o600\)/u);
  assert.match(agent, /values\.get\('FAILOVER_MODE'\) != 'active'/u);
  assert.match(agent, /deny\('mode_not_active'\)/u);
  assert.doesNotMatch(agent, /(?:^|\n)\s*(?:source|eval)\s/u);
  const main = agent.slice(agent.indexOf('def main():'));
  assert.ok(main.indexOf("sys.argv[1] == 'preflight'") < main.indexOf('reply = poll(cfg)'));
  assert.ok(main.indexOf('return\n    reply = poll(cfg)') > 0);
});

test('agent verifies both domain-separated HMACs, expiry, writer binding, terminal state and durable one-time incident', () => {
  for (const required of ['hmac.compare_digest', 'lemtel-promotion-command-v1', 'lemtel-fence-receipt-v1',
    'expiry <= now', 'expiry - issued > 300', 'writer_droplet_id', "proof['terminal_power_state'] != 'off'",
    "proof['terminal_action_status'] != 'completed'", "proof['confirmations'] < 2", 'O_EXCL', 'O_NOFOLLOW',
    'os.fsync', 'incident_already_consumed_manual_review', 'status=manual_promotion_action_required']) {
    assert.ok(agent.includes(required), required);
  }
  assert.match(agent, /command = validate_command\(reply\['command'\], cfg\)\n    incident = command\['incident_id'\]\n    ledger = claim_incident\(incident\)\n    persist_fence_receipt\(incident, command\)/u);
  assert.ok(agent.indexOf('persist_fence_receipt(incident, command)') < agent.indexOf('if not run_local(STAGE_ATTEST'));
  assert.doesNotMatch(agent, /(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree)/u);
});

test('agent keeps network and provider control in the arbiter, validates a fixed local command chain, and defaults to review', () => {
  assert.equal((agent.match(/urllib\.request\.Request\(/g) || []).length, 1);
  assert.match(agent, /cfg\['ARBITER_URL'\]\.rstrip\('\/'\) \+ '\/agent\/command'/u);
  assert.doesNotMatch(agent, /(?:\/droplets\/|\/actions\/|\/zones\/|\/accounts\/|DO_API_TOKEN|DO_API_BASE_URL)/u);
  for (const required of ['PROMOTION_EXECUTION_MODE', 'automatic_execution_acknowledgement_required',
    'persist_fence_receipt', 'fence_receipt_already_persisted_manual_review', 'runtime_stage_attestation_blocked_incident_consumed', 'promotion_execution_started',
    'runtime_start_started', 'promotion_and_runtime_completed', "cfg['PROMOTION_EXECUTION_MODE'] == 'review'"]) {
    assert.ok(agent.includes(required), required);
  }
  assert.equal((agent.match(/subprocess\.run\(/g) || []).length, 1);
  assert.match(agent, /def run_local\(path, env, timeout\)/u);
  assert.doesNotMatch(agent, /(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree|shell\s*=\s*True)/u);
});

test('service and timer are uninstalled, unenabled templates with no Install/WantedBy or active mode', () => {
  for (const text of [service, timer]) {
    assert.match(text, /NOT installed, NOT enabled, NOT started/u);
    assert.doesNotMatch(text, /^\s*(?:\[Install\]|WantedBy=|RequiredBy=|Also=|Alias=)/mu);
    assert.doesNotMatch(text, /FAILOVER_MODE=active|ExecStartPre=|ExecStartPost=|ExecReload=/u);
  }
  assert.match(service, /^User=root$/mu);
  assert.match(service, /^UMask=0077$/mu);
  assert.match(service, /^Environment=LEMTEL_HA_ROLE=hostinger_standby$/mu);
  assert.match(service, /failover-agent\.sh poll/u);
  assert.match(timer, /^Persistent=false$/mu);
  const contract = JSON.parse(read('current-topology-contract.json'));
  assert.ok(Object.values(contract.activation).every((value) => value === false));
  assert.ok(Object.values(contract.fail_closed_gates).every((value) => value === false));
});

test('mailbox delivers a prepared command exactly once, after recording the dispatch intent and state', async (t) => {
  const f = await fixture(t);
  await gracefulCommand(f);
  const prepared = await f.incident();
  f.now += 16; // the scheduler lease (15 s) has expired
  const res = await f.get('/agent/command', true);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const reply = await res.json();
  // Exact shapes the Hostinger agent accepts.
  assert.deepEqual(Object.keys(reply).sort(), ['command', 'state']);
  assert.equal(reply.state, 'command_available');
  assert.deepEqual(reply.command, prepared.command);
  assert.deepEqual(Object.keys(reply.command.payload).sort(), ['expires_at', 'fence_receipt', 'format', 'incident_id',
    'issued_at', 'name', 'nonce', 'target_role', 'writer_role']);
  assert.deepEqual(Object.keys(reply.command.payload.fence_receipt.payload).sort(), ['confirmations', 'format', 'incident_id',
    'observed_at', 'provider_action_id', 'provider_action_type', 'terminal_action_status', 'terminal_power_state', 'writer_droplet_id', 'writer_role']);
  assert.equal(reply.command.signature, signature(f.configuration.AGENT_SHARED_SECRET, 'lemtel-promotion-command-v1', reply.command.payload));
  assert.equal(reply.command.payload.fence_receipt.signature, signature(f.configuration.AGENT_SHARED_SECRET,
    'lemtel-fence-receipt-v1', reply.command.payload.fence_receipt.payload));
  const after = await f.incident();
  assert.equal(after.phase, 'promotion_command_dispatched');
  assert.equal(after.dispatched_at, f.now);
  const ledger = [...f.serializer.storage.values.keys()].filter((key) => key.startsWith('intent:'));
  assert.equal(ledger.length, 3, 'shutdown, promotion and dispatch intents are each recorded once');
  f.now += 16;
  assert.deepEqual(await (await f.get('/agent/command', true)).json(), { state: 'no_command' }, 'never re-delivered');
  assert.equal((await f.tick()).state, 'manual_promotion_action_required');
  const publicStatus = await (await f.get('/status')).json();
  assert.equal(publicStatus.command, undefined);
  assert.ok(!JSON.stringify(publicStatus).includes(writerID));
  assert.deepEqual(f.posts(), ['shutdown'], 'delivery never triggers a provider action');
});

test('mailbox refuses while the scheduler holds the serializer lease, without changing the incident', async (t) => {
  const f = await fixture(t);
  await gracefulCommand(f);
  const res = await f.get('/agent/command', true);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).command, undefined);
  assert.equal((await f.incident()).phase, 'promotion_command_ready');
  f.now += 16;
  assert.equal((await (await f.get('/agent/command', true)).json()).state, 'command_available');
});

test('an unrecorded dispatch never releases the command; the incident then requires manual review', async (t) => {
  const f = await fixture(t);
  await gracefulCommand(f);
  f.now += 16;
  f.failDispatchPersist = true;
  const first = await f.get('/agent/command', true);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).command, undefined);
  f.failDispatchPersist = false;
  f.now += 16;
  const second = await f.get('/agent/command', true);
  assert.deepEqual(await second.json(), { state: 'no_command' });
  const incident = await f.incident();
  assert.equal(incident.phase, 'blocked');
  assert.equal(incident.reason, 'command_delivery_unknown_manual_review');
  assert.equal((await f.tick()).state, 'blocked');
});

test('a writer that looks down is never fenced while the standby has not recently proven readiness', async (t) => {
  const f = await fixture(t);
  f.autoReady = false;
  assert.equal((await f.tick()).state, 'incident_suspected');
  assert.equal((await f.tick()).state, 'incident_suspected');
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const result = await f.tick();
    assert.equal(result.state, 'blocked');
    assert.equal(result.reason, 'standby_not_ready_no_fencing');
  }
  assert.deepEqual(f.posts(), [], 'no provider action without standby readiness');
  // Stale, negative or incomplete readiness are all refused.
  for (const payload of [f.readinessPayload({ observed_at: f.now - 600 }), f.readinessPayload({ ready: false }),
    f.readinessPayload({ standby_in_recovery: false }), f.readinessPayload({ runtime_stage_present: false })]) {
    await f.setReadiness({ ...payload, observed_at: payload.observed_at === f.now ? f.now + 60 : payload.observed_at });
    assert.equal((await f.tick()).reason, 'standby_not_ready_no_fencing');
  }
  assert.deepEqual(f.posts(), []);
  f.autoReady = true;
  assert.equal((await f.tick()).state, 'fence_wait_graceful');
  assert.deepEqual(f.posts(), ['shutdown']);
});

test('a standby outage alone never starts an incident: the writer marker stays healthy', async (t) => {
  const f = await fixture(t);
  f.health = 'healthy'; f.autoReady = false;
  for (let cycle = 0; cycle < 5; cycle += 1) assert.equal((await f.tick()).state, 'healthy');
  assert.deepEqual(f.posts(), []);
});

test('repeated Cloudflare origin-down answers (521/522) count as a definitive writer failure', async (t) => {
  const f = await fixture(t);
  f.health = 'origin_down';
  assert.equal((await f.tick()).state, 'incident_suspected');
  f.health = 'origin_down_521';
  assert.equal((await f.tick()).state, 'incident_suspected');
  f.health = 'origin_down';
  assert.equal((await f.tick()).state, 'fence_wait_graceful');
  assert.deepEqual(f.posts(), ['shutdown']);
});

test('origin errors without Cloudflare provenance, and other edge errors, stay ambiguous', async (t) => {
  for (const health of ['origin_down_no_ray', 'edge_524', 'arbitrary_5xx', 'timeout']) {
    const f = await fixture(t);
    f.health = health;
    for (let cycle = 0; cycle < 4; cycle += 1) assert.equal((await f.tick()).reason, 'l7_health_ambiguous_no_fencing', health);
    assert.deepEqual(f.posts(), [], health);
  }
});

test('agent poll records signed readiness; forged, malformed or stale readiness is ignored', async (t) => {
  const f = await fixture(t);
  f.autoReady = false;
  const poll = (header) => worker.fetch(new Request(fakeURL('arbiter') + '/agent/command', { headers: {
    authorization: `Bearer ${f.configuration.AGENT_SHARED_SECRET}`, ...(header ? { 'x-lemtel-standby-readiness': header } : {}) } }), f.env);
  for (const make of [() => f.readinessHeader(f.readinessPayload(), secret('wrong-agent')), () => 'not-base64-json!',
    () => f.readinessHeader(f.readinessPayload({ observed_at: f.now - 600 })), () => f.readinessHeader({ ...f.readinessPayload(), extra: 1 })]) {
    f.now += 16; // each poll takes the 15 s serializer lease
    assert.equal((await poll(make())).status, 200);
    assert.equal(f.values.has(readinessKey), false);
  }
  f.now += 16;
  assert.deepEqual(await (await poll(f.readinessHeader())).json(), { state: 'no_command' });
  const stored = await f.open(f.values.get(readinessKey));
  assert.equal(stored.ready, true);
  assert.equal(stored.observed_at, f.now);
  assert.ok(!f.values.get(readinessKey).includes('hostinger_standby'), 'readiness is sealed in KV');
  // An older report never replaces a newer one.
  f.now += 16;
  await poll(f.readinessHeader(f.readinessPayload({ observed_at: f.now - 30, ready: false })));
  assert.equal((await f.open(f.values.get(readinessKey))).ready, true);
});

test('a sealed configuration and drill approval can stay valid for a permanent arbiter (up to 90 days), not beyond', async (t) => {
  const f = await fixture(t);
  const day = 86400;
  const seal = async (kind, payload, expires) => {
    const metadata = { format: 'lemtel_failover_sealed_state_v1', version: 1, algorithm: 'AES-256-GCM', kind,
      config_revision: f.env.CONFIG_REVISION, issued_at: f.now, expires_at: expires };
    const session = await sessionPromise;
    const aes = await crypto.subtle.importKey('raw', decode(session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
      additionalData: encode(protocol.stateContext, metadata) }, aes, new TextEncoder().encode(JSON.stringify(payload)));
    return JSON.stringify({ ...metadata, iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') });
  };
  const install = async (configDays, drillDays) => {
    f.values.clear();
    f.values.set(`${prefix}:bootstrap-consumed:${f.env.CONFIG_REVISION}`, JSON.stringify({ format: 'lemtel_bootstrap_consumed_v1', version: 1 }));
    const expires = f.now + configDays * day;
    f.values.set(`${prefix}:sealed-config:${f.env.CONFIG_REVISION}`, await seal('configuration', { format: 'lemtel_failover_protected_config_v1',
      config_revision: f.env.CONFIG_REVISION, issued_at: f.now, expires_at: expires, configuration: f.configuration }, expires));
    const payload = { format: 'lemtel_production_destructive_drill_v1', config_revision: f.env.CONFIG_REVISION,
      writer_role: 'do_writer', target_role: 'hostinger_standby', writer_droplet_id: writerID,
      destructive_drill_validated: true, serialized_execution_verified: true, validated_at: f.now, expires_at: f.now + drillDays * day };
    f.values.set(drillKey, await seal('drill', { payload, signature: signature(f.configuration.DRILL_APPROVAL_SECRET, 'lemtel-production-drill-v1', payload) },
      f.now + Math.min(drillDays, 90) * day));
  };
  f.health = 'healthy'; f.autoReady = false;
  await install(30, 30);
  f.now += 7 * day;
  assert.equal((await f.tick(0)).state, 'healthy', 'still operating a week after bootstrap');
  await install(91, 30);
  assert.equal((await f.tick()).state, 'blocked', 'configuration longer than 90 days is refused');
  await install(30, 91);
  assert.equal((await f.tick()).reason, 'production_drill_or_serialization_not_verified', 'drill approval longer than 90 days is refused');
});
