import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
import { canonical, protocol, createBootstrapSession, createBootstrapEnvelope, sealDrillReceipt,
  injectBootstrapConfiguration } from '../infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs';

// Synthetic fixtures only. No real secrets/IDs/endpoints; global fetch always fails if reached.
const source = readFileSync(new URL('../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs', import.meta.url), 'utf8');
const sessionPromise = createBootstrapSession('synthetic-sealed-v1');
const prefix = 'lemtel_failover_execution_v1';
const origin = `https://${['sealed-arbiter', 'test', 'invalid'].join('.')}`;
const configKey = (f) => `${prefix}:sealed-config:${f.env.CONFIG_REVISION}`;
const proof = (secret, value, context = protocol.authContext) =>
  createHmac('sha256', secret).update(`${context}\n${canonical(value)}`).digest('hex');
const flip = (value) => (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
const fixtureSecret = (label) => `synthetic-${label}-${'x'.repeat(48)}`;
const sensitiveValues = (f) => [...Object.values(f.session.secretBindings), ...Object.values(f.configuration).slice(0, 7)];

async function fixture(t) {
  const base = await sessionPromise;
  const f = { session: { ...base, secretBindings: { ...base.secretBindings }, textBindings: { ...base.textBindings } },
    now: Math.floor(Date.UTC(2032, 0, 1) / 1000), values: new Map(), reads: [], writes: [], calls: [], failWrite: null };
  f.configuration = { DO_API_TOKEN: fixtureSecret('provider'), AGENT_SHARED_SECRET: fixtureSecret('agent'),
    DO_WRITER_L7_SECRET: fixtureSecret('l7'), DRILL_APPROVAL_SECRET: fixtureSecret('drill'), DO_WRITER_DROPLET_ID: '7'.repeat(9),
    DO_API_BASE_URL: `${origin}/v2`, DO_WRITER_L7_URL: `${origin}/lemtel-lb-ready`,
    ARBITER_SERIALIZATION_ACK: 'reviewed_single_serialized_scheduler', OBSERVATION_INTERVAL_SECONDS: '60',
    INCIDENT_FAILURE_CYCLES: '3', GRACEFUL_SHUTDOWN_DELAY_SECONDS: '180', POWER_STATE_TIMEOUT_SECONDS: '1800', COMMAND_TTL_SECONDS: '120' };
  f.STATE = {
    async get(key) {
      f.reads.push(key);
      if (f.readBarrier) { const barrier = f.readBarrier; f.readBarrier = null; f.readPending = true; await barrier; }
      return f.values.get(key) ?? null;
    },
    async put(key, value) {
      f.writes.push({ key, value });
      if (f.failWrite && key.includes(f.failWrite)) throw new Error(f.configuration.DO_API_TOKEN);
      f.values.set(key, value);
    },
  };
  f.env = { FAILOVER_MODE: 'bootstrap', STATE: f.STATE, ...f.session.textBindings, ...f.session.secretBindings };
  t.mock.method(Date, 'now', () => f.now * 1000);
  t.mock.method(globalThis, 'fetch', async (...args) => { f.calls.push(args); throw new Error('unexpected_synthetic_outbound_call'); });
  f.get = (path = protocol.keyPath) => worker.fetch(new Request(origin + path), f.env);
  f.make = (configuration = f.configuration, options = {}) => createBootstrapEnvelope({ session: f.session,
    publicDescriptor: f.session.publicDescriptor, configuration, now: f.now, ...options });
  f.post = (envelope, signature = proof(f.session.secretBindings.BOOTSTRAP_AUTH_SECRET, envelope), headers = {}) => {
    const requestHeaders = { 'content-type': 'application/json', ...headers };
    if (signature !== null) requestHeaders['x-lemtel-bootstrap-proof'] = signature;
    return worker.fetch(new Request(origin + protocol.bootstrapPath,
      { method: 'POST', headers: requestHeaders, body: JSON.stringify(envelope) }), f.env);
  };
  f.inject = async () => { const injection = await f.make(); const result = await f.post(injection.envelope, injection.proof); assert.equal(result.status, 201); return injection; };
  f.active = () => { f.env = { FAILOVER_MODE: 'active', STATE: f.STATE, CONFIG_REVISION: f.session.configRevision,
    CONFIG_STATE_ENCRYPTION_KEY: f.session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY }; };
  const aes = await crypto.subtle.importKey('raw', Buffer.from(f.session.secretBindings.CONFIG_STATE_ENCRYPTION_KEY, 'base64url'),
    'AES-GCM', false, ['encrypt', 'decrypt']);
  const aad = (metadata) => new TextEncoder().encode(`${protocol.stateContext}\n${canonical(metadata)}`);
  f.open = async (raw) => {
    const { iv, ciphertext, ...metadata } = JSON.parse(raw);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', tagLength: 128,
      iv: Buffer.from(iv, 'base64url'), additionalData: aad(metadata) }, aes, Buffer.from(ciphertext, 'base64url'))));
  };
  f.reseal = async (kind, payload, times = {}) => {
    const metadata = { format: 'lemtel_failover_sealed_state_v1', version: 1, algorithm: 'AES-256-GCM', kind,
      config_revision: f.env.CONFIG_REVISION, issued_at: f.now, expires_at: f.now + 3600, ...times };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: aad(metadata) },
      aes, new TextEncoder().encode(JSON.stringify(payload)));
    return JSON.stringify({ ...metadata, iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(cipher).toString('base64url') });
  };
  f.drill = async () => {
    const payload = { format: 'lemtel_production_destructive_drill_v1', config_revision: f.session.configRevision,
      writer_role: 'do_writer', target_role: 'hostinger_standby', writer_droplet_id: f.configuration.DO_WRITER_DROPLET_ID,
      destructive_drill_validated: true, serialized_execution_verified: true, validated_at: f.now - 60, expires_at: f.now + 3600 };
    const receipt = { payload, signature: proof(f.configuration.DRILL_APPROVAL_SECRET, payload, 'lemtel-production-drill-v1') };
    f.values.set(`${prefix}:production-drill`, JSON.stringify(await sealDrillReceipt({ session: f.session,
      receipt, issuedAt: f.now, expiresAt: f.now + 3600 })));
  };
  f.blocked = async () => {
    const result = await worker.scheduled({}, f.env);
    assert.equal(result.state, 'blocked');
    const response = await f.get('/agent/command');
    assert.equal(response.status, 409);
    assert.ok(!(await response.json()).command);
    assert.equal(f.calls.length, 0);
  };
  return f;
}

function assertRedacted(f, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of sensitiveValues(f)) assert.ok(!text.includes(secret), 'no synthetic sensitive value may escape');
  for (const name of ['CONFIG_DECRYPTION_PRIVATE_JWK', 'BOOTSTRAP_AUTH_SECRET', 'CONFIG_STATE_ENCRYPTION_KEY',
    'DO_API_TOKEN', 'AGENT_SHARED_SECRET', 'DO_WRITER_L7_SECRET', 'DRILL_APPROVAL_SECRET', 'DO_WRITER_DROPLET_ID', 'DO_API_BASE_URL', 'DO_WRITER_L7_URL']) {
    assert.ok(!text.includes(name), 'no sensitive configuration names in public errors/state or KV');
  }
}

test('explicit crypto and secret binding boundaries; no imports/logs/cleartext KV writes or routing APIs', () => {
  for (const name of ['RSA-OAEP', 'SHA-256', 'AES-GCM', 'CONFIG_DECRYPTION_PRIVATE_JWK', 'CONFIG_DECRYPTION_PUBLIC_JWK',
    'BOOTSTRAP_AUTH_SECRET', 'CONFIG_STATE_ENCRYPTION_KEY', 'tagLength: 128', 'crypto.getRandomValues', 'additionalData']) assert.ok(source.includes(name));
  assert.match(source, /await env\.STATE\.put\(configKey, JSON\.stringify\(sealed\)\)/u);
  assert.match(source, /await env\.STATE\.put\(INCIDENT_KEY, JSON\.stringify\(sealed\)\)/u);
  assert.doesNotMatch(source, /\.put\([^\n]*JSON\.stringify\((?:payload|incident|configuration|privateJWK)\)/u);
  assert.doesNotMatch(source + controllerSource, /console\.|process\.env|writeFile|readFile|localStorage|-----BEGIN|dop_v1_|github_pat_|ghp_/u);
  assert.doesNotMatch(source, /^\s*import\s|load_balancers|dns_records|\/zones\/|\/accounts\//mu);
  assert.match(source, /const ROUTING_ENABLED = false/u);
  assert.match(source, /automatic_failback_enabled: false/u);
  assert.doesNotMatch(controllerSource, /\bfetch\s*\(/u);
  const handler = source.slice(source.indexOf('async function bootstrap('), source.indexOf('async function storeStatus('));
  assert.doesNotMatch(handler, /await (?:provider|observe|tick|requestFence|issueCommand|readiness)\(|FAILOVER_MODE\s*=/u);
  assert.match(source, /No fallback to plaintext operational env bindings/u);
});

test('disabled/unknown modes refuse both bootstrap endpoints and perform absolutely no KV or outbound activity', async (t) => {
  const f = await fixture(t), { envelope } = await f.make();
  for (const mode of [undefined, 'disabled', 'dry_run', 'BOOTSTRAP', 'bootstrap ', 'active ']) {
    f.env.FAILOVER_MODE = mode;
    assert.equal((await f.get()).status, 404);
    assert.equal((await f.post(envelope)).status, 404);
    assert.equal((await worker.scheduled({}, f.env)).state, 'disabled_or_dry_run');
    assert.equal((await (await f.get('/agent/command')).json()).state, 'disabled_or_dry_run');
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, []);
});

test('public key is served only in bootstrap and needs no private/auth/state secrets', async (t) => {
  const f = await fixture(t);
  for (const name of Object.keys(f.session.secretBindings)) delete f.env[name];
  delete f.env.STATE;
  const response = await f.get(), descriptor = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(descriptor).sort(), ['algorithm', 'format', 'kid', 'public_jwk', 'version']);
  assert.deepEqual(descriptor, f.session.publicDescriptor);
  assert.deepEqual(Object.keys(descriptor.public_jwk).sort(), ['alg', 'e', 'ext', 'key_ops', 'kty', 'n']);
  assertRedacted(f, descriptor);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const mode of ['active', 'disabled']) { f.env.FAILOVER_MODE = mode; assert.equal((await f.get()).status, 404); }
  assert.equal(f.reads.length + f.writes.length + f.calls.length, 0);
});

test('a public binding contaminated by a private or unknown component is rejected without echo', async (t) => {
  const f = await fixture(t);
  for (const field of ['d', 'p', 'secret', 'url']) {
    f.env.CONFIG_DECRYPTION_PUBLIC_JWK = JSON.stringify({ ...f.session.publicDescriptor.public_jwk, [field]: f.configuration.DO_API_TOKEN });
    const response = await f.get(); assert.equal(response.status, 409); assertRedacted(f, await response.json());
  }
});

test('POST requires a domain-separated HMAC over the entire envelope, not a bearer token', async (t) => {
  const f = await fixture(t), { envelope, proof: signature } = await f.make();
  for (const supplied of [null, '0'.repeat(64), signature.toUpperCase(), proof(f.session.secretBindings.BOOTSTRAP_AUTH_SECRET, envelope, 'wrong-context')]) {
    const response = await f.post(envelope, supplied);
    assert.equal(response.status, 401); assertRedacted(f, await response.json());
  }
  const changed = { ...envelope, nonce: Buffer.alloc(32, 5).toString('base64url') };
  assert.equal((await f.post(changed, signature)).status, 401);
  assert.equal(f.reads.length + f.writes.length + f.calls.length, 0);
});

test('valid injection stores only ciphertext/redacted tombstones and never enables active or issues a command', async (t) => {
  const f = await fixture(t);
  await f.inject();
  assert.equal(f.env.FAILOVER_MODE, 'bootstrap');
  const record = JSON.parse(f.values.get(configKey(f)));
  assert.equal(record.algorithm, 'AES-256-GCM'); assert.equal(Buffer.from(record.iv, 'base64url').length, 12);
  assert.deepEqual(Object.keys(record).sort(), ['algorithm', 'ciphertext', 'config_revision', 'expires_at', 'format', 'issued_at', 'iv', 'kind', 'version']);
  assert.deepEqual((await f.open(f.values.get(configKey(f)))).configuration, f.configuration);
  for (const [key, value] of f.values) { assertRedacted(f, key); assertRedacted(f, value); }
  const counts = [f.reads.length, f.writes.length];
  const scheduled = await worker.scheduled({}, f.env);
  assert.equal(scheduled.state, 'bootstrap'); assert.equal(scheduled.automatic_traffic_routing_enabled, false);
  assert.equal((await f.get('/agent/command')).status, 404);
  assert.deepEqual([f.reads.length, f.writes.length], counts); assert.deepEqual(f.calls, []);
  for (const field of ['automatic_promotion_enabled', 'automatic_runtime_start_enabled', 'automatic_traffic_routing_enabled', 'automatic_failback_enabled']) assert.equal(scheduled[field], false);
});

test('at-rest AES-GCM always uses a fresh IV, independently of the transport nonce/IV', async (t) => {
  const f = await fixture(t), injection = await f.inject(), first = JSON.parse(f.values.get(configKey(f)));
  const secondValues = new Map();
  f.env.STATE = { async get(key) { return secondValues.get(key) ?? null; }, async put(key, value) { secondValues.set(key, value); } };
  assert.equal((await f.post(injection.envelope, injection.proof)).status, 201);
  const second = JSON.parse(secondValues.get(configKey(f)));
  assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(first.iv, injection.envelope.iv);
});

test('nonce and revision are one-use, including a different nonce on a consumed revision or reused nonce on a new revision', async (t) => {
  const f = await fixture(t), injection = await f.inject();
  const before = f.values.get(configKey(f));
  assert.equal((await f.post(injection.envelope, injection.proof)).status, 409);
  assert.equal((await f.post((await f.make()).envelope)).status, 409);
  assert.equal(f.values.get(configKey(f)), before);
  f.env.CONFIG_REVISION = 'synthetic-sealed-v2';
  f.session = { ...f.session, configRevision: f.env.CONFIG_REVISION };
  assert.equal((await f.post((await f.make(f.configuration, { nonce: injection.envelope.nonce })).envelope)).status, 409);
  assert.equal((await f.post((await f.make()).envelope)).status, 201);
  // Config deletion/expiry never deletes the durable consumed revision marker.
  f.values.delete(configKey(f));
  assert.equal((await f.post((await f.make()).envelope)).status, 409);
});

test('persisted replay tombstones also reject a replay in a new Worker module/isolate', async (t) => {
  const f = await fixture(t), injection = await f.inject();
  const cold = (await import(`../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs?cold=${crypto.randomUUID()}`)).default;
  const request = new Request(origin + protocol.bootstrapPath, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-lemtel-bootstrap-proof': injection.proof }, body: JSON.stringify(injection.envelope) });
  assert.equal((await cold.fetch(request, f.env)).status, 409);
  assert.equal(f.calls.length, 0);
});

test('expiration, future issuance, revision, algorithm, nonce and extra fields are validated before storing', async (t) => {
  const f = await fixture(t), { envelope } = await f.make();
  for (const change of [{ expires_at: f.now }, { issued_at: f.now + 1 }, { expires_at: f.now + 301 },
    { config_revision: 'synthetic-wrong-revision' }, { algorithm: 'RSA-OAEP' }, { nonce: 'short' }, { extra: true }, { version: 2 }]) {
    const response = await f.post({ ...envelope, ...change });
    assert.equal(response.status, 409); assertRedacted(f, await response.json());
  }
  assert.equal(f.writes.length + f.calls.length, 0);
});

test('complete protected configuration is strict: every field and existing safety bound is mandatory; activation flags are refused', async (t) => {
  const f = await fixture(t);
  for (const name of Object.keys(f.configuration)) {
    const incomplete = { ...f.configuration }; delete incomplete[name];
    assert.equal((await f.post((await f.make(incomplete)).envelope)).status, 409, name);
  }
  const invalid = [ ['DO_API_TOKEN', 'short'], ['AGENT_SHARED_SECRET', null], ['DO_WRITER_L7_SECRET', 123], ['DRILL_APPROVAL_SECRET', ''],
    ['DO_WRITER_DROPLET_ID', '0'], ['DO_API_BASE_URL', `${origin}/wrong`], ['DO_WRITER_L7_URL', `${origin}/unexpected`],
    ['DO_WRITER_L7_URL', `${origin}/lemtel-lb-ready?query=forbidden`], ['ARBITER_SERIALIZATION_ACK', 'unreviewed'],
    ['OBSERVATION_INTERVAL_SECONDS', '59'], ['INCIDENT_FAILURE_CYCLES', '2'], ['GRACEFUL_SHUTDOWN_DELAY_SECONDS', '59'],
    ['POWER_STATE_TIMEOUT_SECONDS', '180'], ['COMMAND_TTL_SECONDS', '301'], ['automatic_traffic_routing_enabled', true], ['FAILOVER_MODE', 'active'] ];
  for (const [name, value] of invalid) {
    const response = await f.post((await f.make({ ...f.configuration, [name]: value })).envelope);
    assert.equal(response.status, 409, name); assertRedacted(f, await response.json());
  }
  assert.equal(f.writes.length + f.calls.length, 0);
});

test('RSA key identity, OAEP label, GCM tag/IV and ciphertext authentication cannot be bypassed by a valid bootstrap HMAC', async (t) => {
  const f = await fixture(t), { envelope } = await f.make();
  for (const change of [{ kid: 'wrong-key' }, { wrapped_key: flip(envelope.wrapped_key) },
    { iv: flip(envelope.iv) }, { ciphertext: flip(envelope.ciphertext) }, { issued_at: f.now - 1 }, { ciphertext: 'A'.repeat(50000) }]) {
    const response = await f.post({ ...envelope, ...change });
    assert.equal(response.status, 409); assertRedacted(f, await response.json());
  }
  assert.equal(f.writes.length + f.calls.length, 0);
});

test('runtime secret bindings, STATE and CONFIG_REVISION are mandatory for injection and never leak in errors', async (t) => {
  const f = await fixture(t), { envelope } = await f.make();
  for (const name of ['STATE', 'CONFIG_REVISION', 'CONFIG_DECRYPTION_PUBLIC_JWK', ...Object.keys(f.session.secretBindings)]) {
    const original = f.env[name]; delete f.env[name];
    const response = await f.post(envelope); assert.equal(response.status, 409, name); assertRedacted(f, await response.json());
    f.env[name] = original;
  }
  f.env.CONFIG_STATE_ENCRYPTION_KEY = fixtureSecret('bad-state-key');
  assert.equal((await f.post(envelope)).status, 409);
  assert.equal(f.writes.length + f.calls.length, 0);
});

test('wrong methods/media type/encoding and oversized or malformed bodies are refused without reflected data', async (t) => {
  const f = await fixture(t), { envelope } = await f.make();
  assert.equal((await f.post(envelope, undefined, { 'content-type': 'text/plain' })).status, 409);
  assert.equal((await f.post(envelope, undefined, { 'content-encoding': 'gzip' })).status, 409);
  for (const path of [protocol.keyPath, protocol.bootstrapPath]) {
    const response = await worker.fetch(new Request(origin + path, { method: 'PUT', body: 'opaque' }), f.env);
    assert.equal(response.status, 405);
  }
  for (const body of ['not-json', 'x'.repeat(65537)]) {
    const response = await worker.fetch(new Request(origin + protocol.bootstrapPath, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body }), f.env);
    assert.equal(response.status, 409); assertRedacted(f, await response.json());
  }
  assert.equal(f.writes.length + f.calls.length, 0);
});

test('uncertain KV write burns the revision/nonce and cannot be retried or used active', async (t) => {
  const f = await fixture(t), injection = await f.make();
  f.failWrite = ':sealed-config:';
  const response = await f.post(injection.envelope, injection.proof); assert.equal(response.status, 409); assertRedacted(f, await response.json());
  f.failWrite = null;
  assert.equal((await f.post(injection.envelope, injection.proof)).status, 409);
  assert.ok(!f.values.has(configKey(f)));
  f.active(); await f.blocked();
});

test('an in-flight bootstrap serializes local attempts and refuses overlaps instead of racing', async (t) => {
  const f = await fixture(t), injection = await f.make();
  let release; f.readBarrier = new Promise((done) => { release = done; });
  const first = f.post(injection.envelope, injection.proof);
  while (!f.readPending) await new Promise((done) => setImmediate(done));
  assert.equal((await f.post(injection.envelope, injection.proof)).status, 409);
  release(); assert.equal((await first).status, 201);
  assert.equal(f.calls.length, 0);
});

test('active refuses plaintext operational env bindings and plaintext/absent protected state', async (t) => {
  const f = await fixture(t); f.active(); Object.assign(f.env, f.configuration);
  await f.blocked();
  f.values.set(configKey(f), JSON.stringify(f.configuration)); await f.blocked();
});

test('even after valid bootstrap, active remains blocked without a signed encrypted drill', async (t) => {
  const f = await fixture(t); await f.inject(); f.active(); await f.blocked();
  await f.drill();
  const encrypted = f.values.get(`${prefix}:production-drill`);
  f.values.set(`${prefix}:production-drill`, JSON.stringify(await f.open(encrypted)));
  await f.blocked();
});

test('active rejects malformed/expired/revision-mismatched sealed config, modified metadata/ciphertext and wrong runtime state key', async (t) => {
  const f = await fixture(t); await f.inject(); f.active();
  const original = f.values.get(configKey(f)), record = JSON.parse(original);
  for (const change of [{ expires_at: f.now }, { config_revision: 'wrong-revision' }, { issued_at: f.now + 1 },
    { algorithm: 'wrong' }, { kind: 'drill' }, { ciphertext: flip(record.ciphertext) }, { iv: flip(record.iv) }, { extra: true }]) {
    f.values.set(configKey(f), JSON.stringify({ ...record, ...change })); await f.blocked();
  }
  f.values.set(configKey(f), original);
  f.env.CONFIG_STATE_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64url'); await f.blocked();
});

test('active revalidates decrypted complete payload and binds inner revision/expiry to authenticated record', async (t) => {
  const f = await fixture(t); await f.inject(); f.active();
  const payload = await f.open(f.values.get(configKey(f)));
  for (const changed of [{ ...payload, config_revision: 'wrong-revision' }, { ...payload, expires_at: f.now + 120 },
    { ...payload, configuration: { ...f.configuration, DO_WRITER_L7_URL: `${origin}/wrong` } },
    { ...payload, configuration: { ...f.configuration, automatic_failback_enabled: true } }]) {
    f.values.set(configKey(f), await f.reseal('configuration', changed)); await f.blocked();
  }
});

test('active cannot use an expired configuration even with an otherwise valid signed drill', async (t) => {
  const f = await fixture(t); await f.inject(); await f.drill(); f.active();
  f.now += 3600; await f.blocked();
});

test('public status reconstructs a redacted whitelist rather than returning arbitrary KV fields/reasons', async (t) => {
  const f = await fixture(t); await f.inject(); await f.drill(); f.active();
  f.values.set(`${prefix}:status`, JSON.stringify({ state: f.configuration.DO_API_TOKEN,
    reason: f.configuration.DO_WRITER_L7_URL, ...f.configuration }));
  const response = await f.get('/status'); assert.equal(response.status, 200);
  assertRedacted(f, await response.json()); assert.equal(f.calls.length, 0);
});

test('single in-memory controller pins the public key, posts ciphertext only and necessarily returns to disabled', async (t) => {
  const f = await fixture(t), modes = [], requests = [];
  f.env.FAILOVER_MODE = 'disabled';
  const options = { session: f.session, configuration: f.configuration, now: f.now,
    enterBootstrap: async () => { modes.push('bootstrap'); f.env.FAILOVER_MODE = 'bootstrap'; },
    returnToDisabled: async () => { modes.push('disabled'); f.env.FAILOVER_MODE = 'disabled'; },
    transport: async (request) => {
      requests.push(request); assertRedacted(f, JSON.stringify(request));
      return worker.fetch(new Request(origin + request.path, { method: request.method, headers: request.headers, body: request.body }), f.env);
    } };
  const result = await injectBootstrapConfiguration(options);
  assert.deepEqual(modes, ['bootstrap', 'disabled']); assert.equal(result.failover_mode, 'disabled'); assertRedacted(f, result);
  assert.equal(f.env.FAILOVER_MODE, 'disabled'); assert.deepEqual(requests.map((request) => request.method), ['GET', 'POST']);
  assert.equal((await f.get()).status, 404);
  await assert.rejects(injectBootstrapConfiguration(options), /bootstrap_injection_rejected/u);
  assert.deepEqual(modes, ['bootstrap', 'disabled']); assert.equal(f.calls.length, 0);
});

test('controller refuses substituted public keys/unknown delivery outcomes; reset is mandatory even on failure', async (t) => {
  const f = await fixture(t), modes = [];
  const options = { session: f.session, configuration: f.configuration, now: f.now,
    enterBootstrap: async () => { modes.push('bootstrap'); }, returnToDisabled: async () => { modes.push('disabled'); },
    transport: async () => new Response(JSON.stringify({ ...f.session.publicDescriptor, kid: 'substituted' }),
      { status: 200, headers: { 'content-type': 'application/json' } }) };
  await assert.rejects(injectBootstrapConfiguration(options), /bootstrap_injection_rejected/u);
  assert.deepEqual(modes, ['bootstrap', 'disabled']);
  const second = { ...options, session: { ...f.session }, transport: async () => { throw new Error(f.configuration.DO_API_TOKEN); } };
  await assert.rejects(injectBootstrapConfiguration(second), /bootstrap_injection_rejected/u);
  assert.deepEqual(modes, ['bootstrap', 'disabled', 'bootstrap', 'disabled']);
  const third = { ...second, session: { ...f.session }, returnToDisabled: async () => { throw new Error('synthetic_reset_failure'); } };
  await assert.rejects(injectBootstrapConfiguration(third), /bootstrap_disabled_reset_unconfirmed/u);
  assert.equal(f.calls.length, 0);
});

test('active requires the bootstrap acceptance marker as well as authenticated encrypted config', async (t) => {
  const f = await fixture(t); await f.inject(); f.active();
  const markerKey = `${prefix}:bootstrap-consumed:${f.env.CONFIG_REVISION}`;
  f.values.delete(markerKey); await f.blocked();
  for (const marker of ['not-json', JSON.stringify({ format: 'wrong', version: 1 }), JSON.stringify({ format: 'lemtel_bootstrap_consumed_v1', version: 1, extra: true })]) {
    f.values.set(markerKey, marker); await f.blocked();
  }
});

test('a bootstrap window expiring during asynchronous KV reads cannot persist or report acceptance', async (t) => {
  const f = await fixture(t), injection = await f.make();
  let release; f.readBarrier = new Promise((done) => { release = done; });
  const pending = f.post(injection.envelope, injection.proof);
  while (!f.readPending) await new Promise((done) => setImmediate(done));
  f.now += 121; release();
  assert.equal((await pending).status, 409); assert.equal(f.writes.length + f.calls.length, 0);
});

test('expiry after readiness but before observation never reaches a health/provider fetch', async (t) => {
  const f = await fixture(t); await f.inject(); await f.drill(); f.active();
  const originalGet = f.STATE.get;
  t.mock.method(f.STATE, 'get', async (key) => {
    const result = await originalGet(key);
    if (key === `${prefix}:production-drill`) f.now += 3600;
    return result;
  });
  assert.equal((await worker.scheduled({}, f.env)).state, 'blocked');
  assert.equal(f.calls.length, 0);
});
