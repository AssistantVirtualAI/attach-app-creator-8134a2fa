// Prepared protocol only: no deployment, secrets, bindings or production approvals included.
// KV is NOT a transactional lock. Strong serialization is exclusively the singleton Durable Object below.
const VERSION = 'lemtel_failover_execution_v1';
const STATUS_KEY = `${VERSION}:status`;
const INCIDENT_KEY = `${VERSION}:incident`;
const DRILL_KEY = `${VERSION}:production-drill`;
const BOOTSTRAP_KEY_PATH = '/.well-known/lemtel-failover-bootstrap-key';
const BOOTSTRAP_PATH = '/.well-known/lemtel-failover-bootstrap';
const BOOTSTRAP_FORMAT = 'lemtel_failover_bootstrap_v1';
const CONFIG_FORMAT = 'lemtel_failover_protected_config_v1';
const SEALED_FORMAT = 'lemtel_failover_sealed_state_v1';
const AUTH_CONTEXT = 'lemtel-failover-bootstrap-auth-v1';
const TRANSPORT_CONTEXT = 'lemtel-failover-bootstrap-transport-v1';
const STATE_CONTEXT = 'lemtel-failover-sealed-state-v1';
const BOOTSTRAP_TTL = 300;
const SERIALIZER_SINGLETON_NAME = 'lemtel-failover-arbiter-serializer-v1';
const SERIALIZER_FORMAT = 'lemtel_failover_serializer_v1';
const SERIALIZER_LEASE_SECONDS = 15; // Deliberately shorter than every configured observation cycle.
const CONFIG_TTL = 3600;
const bootstrapControllers = new WeakMap(); // Local serialization only; KV is NOT a distributed CAS.
const ROUTING_ENABLED = false; // Routing is a separate revision, never an env toggle here.
let tickRunning = false;

const SAFE_STATES = new Set(['disabled_or_dry_run', 'bootstrap', 'blocked', 'observation',
  'healthy', 'cycle_not_due', 'incident_suspected', 'fence_graceful_shutdown_requested',
  'fence_hard_power_off_requested', 'fence_wait_graceful', 'fence_wait_hard', 'fence_poll_terminal',
  'fence_verified', 'promotion_command_ready', 'manual_promotion_action_required']);
const SAFE_REASONS = new Set([...SAFE_STATES, 'not_found', 'method_not_allowed', 'unauthorized',
  'bootstrap_rejected', 'bootstrap_accepted', 'configuration_injection_only',
  'protected_configuration_unavailable', 'active_configuration_incomplete', 'state_unavailable',
  'production_drill_or_serialization_not_verified', 'state_or_drill_receipt_invalid',
  'fence_request_outcome_unknown_manual_review', 'terminal_power_state_timeout',
  'provider_terminal_state_ambiguous', 'terminal_power_state_changed', 'hard_fence_failed',
  'fence_receipt_prerequisites_missing', 'overlapping_tick', 'incident_configuration_mismatch',
  'persisted_fence_intent_requires_manual_reconciliation', 'l7_health_ambiguous_no_fencing',
  'writer_healthy', 'promotion_command_expired', 'unknown_phase', 'state_or_protocol_error_manual_review',
  'promotion_command_expired_or_configuration_changed', 'promotion_command_invalid',
  'command_delivery_unknown_manual_review', 'serializer_lease_unavailable',
  'serializer_lease_expired', 'serializer_incident_refused']);
function status(state, reason = state) {
  state = SAFE_STATES.has(state) ? state : 'blocked';
  reason = SAFE_REASONS.has(reason) ? reason : 'state_or_protocol_error_manual_review';
  return { version: VERSION, state, reason, writer_role: 'do_writer', target_role: 'hostinger_standby',
    automatic_promotion_enabled: false, automatic_runtime_start_enabled: false,
    automatic_traffic_routing_enabled: ROUTING_ENABLED, automatic_failback_enabled: false };
}
function json(value, code = 200) {
  return new Response(JSON.stringify(value), { status: code,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(secret, context, payload) {
  const bytes = await crypto.subtle.sign('HMAC', await signingKey(secret),
    new TextEncoder().encode(`${context}\n${canonical(payload)}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function verify(secret, context, payload, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return false;
  const bytes = Uint8Array.from(signature.match(/../g), (part) => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', await signingKey(secret), bytes,
    new TextEncoder().encode(`${context}\n${canonical(payload)}`));
}
function httpsURL(value, originOnly = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (originOnly && url.pathname !== '/') return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
function l7URL(value) {
  const health = httpsURL(value);
  if (!health) return null;
  try { return new URL(value).pathname === '/lemtel-lb-ready' ? health : null; } catch { return null; }
}
function integer(value, min, max) {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
const CONFIG_KEYS = ['DO_API_TOKEN', 'AGENT_SHARED_SECRET', 'DO_WRITER_L7_SECRET', 'DRILL_APPROVAL_SECRET',
  'DO_WRITER_DROPLET_ID', 'DO_API_BASE_URL', 'DO_WRITER_L7_URL',
  'OBSERVATION_INTERVAL_SECONDS', 'INCIDENT_FAILURE_CYCLES', 'GRACEFUL_SHUTDOWN_DELAY_SECONDS',
  'POWER_STATE_TIMEOUT_SECONDS', 'COMMAND_TTL_SECONDS'];
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function revision(value) { return typeof value === 'string' && /^[a-z0-9-]{8,80}$/.test(value); }
function validTimeWindow(issued, expiry, now, maximum) {
  return Number.isSafeInteger(issued) && Number.isSafeInteger(expiry) &&
    issued <= now && expiry > now && expiry > issued && expiry - issued <= maximum;
}
function validateConfiguration(env) {
  if (!exactKeys(env, CONFIG_KEYS)) return { denied: status('blocked', 'active_configuration_incomplete') };
  const missing = [];
  for (const name of ['DO_API_TOKEN', 'AGENT_SHARED_SECRET', 'DO_WRITER_L7_SECRET', 'DRILL_APPROVAL_SECRET']) {
    if (typeof env[name] !== 'string' || env[name].length < 32 || env[name].length > 4096) missing.push(name);
  }
  if (typeof env.DO_WRITER_DROPLET_ID !== 'string' || !/^[1-9]\d{0,19}$/.test(env.DO_WRITER_DROPLET_ID)) missing.push('DO_WRITER_DROPLET_ID');
  const provider = httpsURL(env.DO_API_BASE_URL);
  const health = l7URL(env.DO_WRITER_L7_URL);
  if (!provider || !provider.endsWith('/v2')) missing.push('DO_API_BASE_URL');
  if (!health || health === provider || health.startsWith(`${provider}/`)) missing.push('DO_WRITER_L7_URL');
  const interval = integer(env.OBSERVATION_INTERVAL_SECONDS, 60, 900);
  const cycles = integer(env.INCIDENT_FAILURE_CYCLES, 3, 20);
  const grace = integer(env.GRACEFUL_SHUTDOWN_DELAY_SECONDS, 60, 900);
  const powerTimeout = integer(env.POWER_STATE_TIMEOUT_SECONDS, 120, 3600);
  const ttl = integer(env.COMMAND_TTL_SECONDS, 30, 300);
  if (!interval) missing.push('OBSERVATION_INTERVAL_SECONDS');
  if (!cycles) missing.push('INCIDENT_FAILURE_CYCLES');
  if (!grace) missing.push('GRACEFUL_SHUTDOWN_DELAY_SECONDS');
  if (!powerTimeout || powerTimeout <= grace) missing.push('POWER_STATE_TIMEOUT_SECONDS');
  if (!ttl) missing.push('COMMAND_TTL_SECONDS');
  return missing.length ? { denied: status('blocked', 'active_configuration_incomplete') } :
    { provider, health, interval, cycles, grace, powerTimeout, ttl };
}
function serializerOrigin() { return ['https:', '', 'serializer.invalid'].join('/'); }
function serializerExecutionKey(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/u.test(value); }
function serializerCapability(value) { return serializerExecutionKey(value); }
function serializerIncident(value) { return typeof value === 'string' && /^[a-z0-9-]{8,80}$/u.test(value); }
function serializerIntent(value) { return value === 'shutdown' || value === 'power_off' || value === 'promotion'; }
function serializerLeaseRecord(value) {
  return exactKeys(value, ['format', 'execution_key', 'config_revision', 'capability', 'expires_at']) &&
    value.format === SERIALIZER_FORMAT && serializerExecutionKey(value.execution_key) && revision(value.config_revision) &&
    serializerCapability(value.capability) && Number.isSafeInteger(value.expires_at);
}
function serializerReply(value) {
  return exactKeys(value, ['format', 'outcome', 'lease']) && value.format === SERIALIZER_FORMAT &&
    value.outcome === 'granted' && serializerLeaseRecord(value.lease);
}
function serializerRefused() { return json({ format: SERIALIZER_FORMAT, outcome: 'refused' }, 409); }
function serializerGranted(lease) { return json({ format: SERIALIZER_FORMAT, outcome: 'granted', lease }); }
async function serializerMessage(request) {
  try {
    if (request.method !== 'POST' || request.headers.get('content-type')?.toLowerCase().split(';')[0].trim() !== 'application/json' ||
        request.headers.get('content-encoding')) return null;
    const url = new URL(request.url);
    if (url.origin !== serializerOrigin() || url.search || url.hash) return null;
    return { path: url.pathname, body: await responseJSON(request) };
  } catch { return null; }
}

// This class belongs to the same Worker module but has no public route. Only a Durable Object binding can address it.
// Its fixed name yields one global object ID; storage.transaction is the only serialization/ledger authority.
export class LemtelFailoverSerializer {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const message = await serializerMessage(request);
    if (!message) return serializerRefused();
    const now = Math.floor(Date.now() / 1000);
    if (message.path === '/lease') return this.acquire(message.body, now);
    if (message.path === '/intent') return this.recordIntent(message.body, now);
    return serializerRefused();
  }

  async acquire(body, now) {
    if (!exactKeys(body, ['execution_key', 'config_revision']) || !serializerExecutionKey(body.execution_key) || !revision(body.config_revision)) {
      return serializerRefused();
    }
    try {
      const result = await this.state.storage.transaction(async (storage) => {
        const existing = await storage.get('lease');
        if (existing !== undefined && existing !== null && !serializerLeaseRecord(existing)) return null;
        if (serializerLeaseRecord(existing) && existing.expires_at > now) {
          return existing.execution_key === body.execution_key && existing.config_revision === body.config_revision ? existing : null;
        }
        const lease = { format: SERIALIZER_FORMAT, execution_key: body.execution_key, config_revision: body.config_revision,
          capability: crypto.randomUUID(), expires_at: now + SERIALIZER_LEASE_SECONDS };
        await storage.put('lease', lease);
        return lease;
      });
      return result ? serializerGranted(result) : serializerRefused();
    } catch { return serializerRefused(); }
  }

  async recordIntent(body, now) {
    if (!exactKeys(body, ['execution_key', 'config_revision', 'capability', 'incident_id', 'intent']) ||
        !serializerExecutionKey(body.execution_key) || !revision(body.config_revision) || !serializerCapability(body.capability) ||
        !serializerIncident(body.incident_id) || !serializerIntent(body.intent)) return serializerRefused();
    try {
      const result = await this.state.storage.transaction(async (storage) => {
        const lease = await storage.get('lease');
        if (!serializerLeaseRecord(lease) || lease.expires_at <= now || lease.execution_key !== body.execution_key ||
            lease.config_revision !== body.config_revision || lease.capability !== body.capability) return null;
        // The opaque digest avoids retaining an incident identifier in the durable ledger in clear form.
        const ledgerKey = `intent:${await digest(`${body.incident_id}\n${body.intent}`)}`;
        const recorded = await storage.get(ledgerKey);
        if (recorded !== undefined && recorded !== null) return null;
        await storage.put(ledgerKey, { format: SERIALIZER_FORMAT, config_revision: body.config_revision, intent: body.intent,
          recorded_at: now });
        return lease;
      });
      return result ? serializerGranted(result) : serializerRefused();
    } catch { return serializerRefused(); }
  }
}

function serializerStub(env) {
  try {
    if (!env.ARBITER_SERIALIZER || typeof env.ARBITER_SERIALIZER.idFromName !== 'function' ||
        typeof env.ARBITER_SERIALIZER.get !== 'function') return null;
    const stub = env.ARBITER_SERIALIZER.get(env.ARBITER_SERIALIZER.idFromName(SERIALIZER_SINGLETON_NAME));
    return stub && typeof stub.fetch === 'function' ? stub : null;
  } catch { return null; }
}
function validLease(lease, env) {
  if (!lease || typeof lease !== 'object') return false;
  const { stub: _stub, ...record } = lease;
  return serializerLeaseRecord(record) && record.config_revision === env.CONFIG_REVISION &&
    record.expires_at > Math.floor(Date.now() / 1000);
}
async function serializerCall(stub, path, body) {
  try {
    const response = await stub.fetch(new Request(`${serializerOrigin()}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
    const reply = await responseJSON(response);
    return serializerReply(reply) ? reply.lease : null;
  } catch { return null; }
}
async function acquireLease(env) {
  const stub = serializerStub(env), execution_key = crypto.randomUUID();
  if (!stub) return null;
  const lease = await serializerCall(stub, '/lease', { execution_key, config_revision: env.CONFIG_REVISION });
  return lease && lease.execution_key === execution_key && validLease(lease, env) ? { ...lease, stub } : null;
}
async function recordSerializedIntent(env, lease, incident_id, intent) {
  if (!lease || !validLease(lease, env) || !serializerIncident(incident_id) || !serializerIntent(intent)) return false;
  const confirmed = await serializerCall(lease.stub, '/intent', { execution_key: lease.execution_key,
    config_revision: env.CONFIG_REVISION, capability: lease.capability, incident_id, intent });
  return !!confirmed && confirmed.execution_key === lease.execution_key && confirmed.capability === lease.capability && validLease(confirmed, env);
}

function validProtectedPayload(payload, env, now) {
  return exactKeys(payload, ['format', 'config_revision', 'issued_at', 'expires_at', 'configuration']) &&
    payload.format === CONFIG_FORMAT && revision(env.CONFIG_REVISION) &&
    payload.config_revision === env.CONFIG_REVISION &&
    validTimeWindow(payload.issued_at, payload.expires_at, now, CONFIG_TTL) &&
    !validateConfiguration(payload.configuration).denied;
}
function bytes(text, length, maximum = length) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(maximum * 4 / 3)) throw new Error('invalid');
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const result = Uint8Array.from(raw, (part) => part.charCodeAt(0));
  if (result.length < length || result.length > maximum || base64url(result) !== text) throw new Error('invalid');
  return result;
}
function base64url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function encoded(context, value) { return new TextEncoder().encode(`${context}\n${canonical(value)}`); }
async function digest(value) { return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
function stateAvailable(env) { return env.STATE && typeof env.STATE.get === 'function' && typeof env.STATE.put === 'function'; }
async function stateKey(env) {
  // Exclusively a runtime secret binding; never a property of the accepted configuration.
  return crypto.subtle.importKey('raw', bytes(env.CONFIG_STATE_ENCRYPTION_KEY, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function publicIdentity(env) {
  const jwk = JSON.parse(env.CONFIG_DECRYPTION_PUBLIC_JWK);
  if (!jwk || Object.keys(jwk).some((name) => !['kty', 'n', 'e', 'alg', 'ext', 'key_ops'].includes(name)) ||
      jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || (jwk.alg !== undefined && jwk.alg !== 'RSA-OAEP-256') ||
      (jwk.key_ops !== undefined && canonical(jwk.key_ops) !== '["encrypt"]') ||
      (jwk.ext !== undefined && jwk.ext !== true)) throw new Error('invalid');
  bytes(jwk.n, 384, 512); // RSA 3072–4096 bits, public components only.
  const public_jwk = { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
  await crypto.subtle.importKey('jwk', public_jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  return { public_jwk, kid: await digest(canonical({ e: jwk.e, kty: 'RSA', n: jwk.n })) };
}
async function sealState(env, kind, payload, issued_at, expires_at) {
  const metadata = { format: SEALED_FORMAT, version: 1, algorithm: 'AES-256-GCM', kind,
    config_revision: env.CONFIG_REVISION, issued_at, expires_at };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
    additionalData: encoded(STATE_CONTEXT, metadata) }, await stateKey(env), new TextEncoder().encode(JSON.stringify(payload)));
  return { ...metadata, iv: base64url(iv), ciphertext: base64url(ciphertext) };
}
async function openState(env, kind, raw, now) {
  const record = JSON.parse(raw);
  if (!exactKeys(record, ['format', 'version', 'algorithm', 'kind', 'config_revision', 'issued_at', 'expires_at', 'iv', 'ciphertext']) ||
      record.format !== SEALED_FORMAT || record.version !== 1 || record.algorithm !== 'AES-256-GCM' ||
      record.kind !== kind || record.config_revision !== env.CONFIG_REVISION ||
      !validTimeWindow(record.issued_at, record.expires_at, now, CONFIG_TTL)) throw new Error('invalid');
  const { iv, ciphertext, ...metadata } = record;
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv, 12), tagLength: 128,
    additionalData: encoded(STATE_CONTEXT, metadata) }, await stateKey(env), bytes(ciphertext, 17, 65536));
  return { record, payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) };
}
async function config(env, now) {
  if (env.FAILOVER_MODE !== 'active') return { denied: status('disabled_or_dry_run') };
  try {
    if (!stateAvailable(env) || !revision(env.CONFIG_REVISION)) throw new Error('invalid');
    const receipt = JSON.parse(await env.STATE.get(`${VERSION}:bootstrap-consumed:${env.CONFIG_REVISION}`));
    if (!exactKeys(receipt, ['format', 'version']) || receipt.format !== 'lemtel_bootstrap_consumed_v1' ||
        receipt.version !== 1) throw new Error('invalid');
    const { record, payload } = await openState(env, 'configuration',
      await env.STATE.get(`${VERSION}:sealed-config:${env.CONFIG_REVISION}`), now);
    if (!validProtectedPayload(payload, env, now) || record.issued_at !== payload.issued_at ||
        record.expires_at !== payload.expires_at) throw new Error('invalid');
    // No fallback to plaintext operational env bindings. Only this decrypted, validated object is used.
    return { ...validateConfiguration(payload.configuration), runtime: { ...payload.configuration,
      STATE: env.STATE, ARBITER_SERIALIZER: env.ARBITER_SERIALIZER, CONFIG_REVISION: env.CONFIG_REVISION,
      CONFIG_STATE_ENCRYPTION_KEY: env.CONFIG_STATE_ENCRYPTION_KEY,
      protectedIssuedAt: payload.issued_at, protectedExpiresAt: payload.expires_at } };
  } catch { return { denied: status('blocked', 'protected_configuration_unavailable') }; }
}
async function bootstrap(request, env, path, now) {
  // HTTP bootstrap is disjoint from readiness/tick/provider/command delivery. Never changes mode.
  if (path === BOOTSTRAP_KEY_PATH) {
    if (request.method !== 'GET') return json(status('blocked', 'method_not_allowed'), 405);
    try { return json({ format: 'lemtel_failover_bootstrap_key_v1', version: 1,
      algorithm: 'RSA-OAEP-256+A256GCM', ...await publicIdentity(env) }); }
    catch { return json(status('blocked', 'bootstrap_rejected'), 409); }
  }
  if (path !== BOOTSTRAP_PATH) return json(status('bootstrap', 'not_found'), 404);
  if (request.method !== 'POST') return json(status('blocked', 'method_not_allowed'), 405);
  if (!stateAvailable(env)) return json(status('blocked', 'bootstrap_rejected'), 409);
  let controller = bootstrapControllers.get(env.STATE);
  if (!controller) { controller = { running: false, consumed: new Set() }; bootstrapControllers.set(env.STATE, controller); }
  if (controller.running) return json(status('blocked', 'bootstrap_rejected'), 409);
  controller.running = true;
  try {
    if (!revision(env.CONFIG_REVISION) || typeof env.BOOTSTRAP_AUTH_SECRET !== 'string' ||
        env.BOOTSTRAP_AUTH_SECRET.length < 32 || env.BOOTSTRAP_AUTH_SECRET.length > 4096 ||
        request.headers.get('content-type')?.toLowerCase().split(';')[0].trim() !== 'application/json' ||
        request.headers.get('content-encoding')) throw new Error('invalid');
    const envelope = await responseJSON(request);
    if (!exactKeys(envelope, ['format', 'version', 'algorithm', 'kid', 'config_revision', 'nonce', 'issued_at',
      'expires_at', 'wrapped_key', 'iv', 'ciphertext']) || envelope.format !== BOOTSTRAP_FORMAT ||
        envelope.version !== 1 || envelope.algorithm !== 'RSA-OAEP-256+A256GCM' ||
        envelope.config_revision !== env.CONFIG_REVISION ||
        !validTimeWindow(envelope.issued_at, envelope.expires_at, now, BOOTSTRAP_TTL)) throw new Error('invalid');
    bytes(envelope.nonce, 32);
    if (!await verify(env.BOOTSTRAP_AUTH_SECRET, AUTH_CONTEXT, envelope,
      request.headers.get('x-lemtel-bootstrap-proof'))) return json(status('blocked', 'unauthorized'), 401);
    const identity = await publicIdentity(env);
    if (envelope.kid !== identity.kid) throw new Error('invalid');
    const privateJWK = JSON.parse(env.CONFIG_DECRYPTION_PRIVATE_JWK);
    if (privateJWK.kty !== 'RSA' || privateJWK.n !== identity.public_jwk.n || privateJWK.e !== identity.public_jwk.e) throw new Error('invalid');
    const key = await crypto.subtle.importKey('jwk', { ...privateJWK, ext: false, key_ops: ['decrypt'] },
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const { wrapped_key, iv, ciphertext, ...metadata } = envelope;
    const label = encoded(TRANSPORT_CONTEXT, metadata);
    const transportKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP', label }, key,
      bytes(wrapped_key, bytes(identity.public_jwk.n, 384, 512).length));
    if (transportKey.byteLength !== 32) throw new Error('invalid');
    const aes = await crypto.subtle.importKey('raw', transportKey, 'AES-GCM', false, ['decrypt']);
    new Uint8Array(transportKey).fill(0); // Best effort; engine copies/JS objects cannot be guaranteed zeroized.
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv, 12), tagLength: 128,
      additionalData: label }, aes, bytes(ciphertext, 17, 32768));
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clear));
    new Uint8Array(clear).fill(0);
    const checkedAt = Math.floor(Date.now() / 1000);
    if (!validTimeWindow(envelope.issued_at, envelope.expires_at, checkedAt, BOOTSTRAP_TTL) ||
        !validProtectedPayload(payload, env, checkedAt) || payload.issued_at !== envelope.issued_at ||
        payload.expires_at < envelope.expires_at) throw new Error('invalid');
    const sealed = await sealState(env, 'configuration', payload, payload.issued_at, payload.expires_at);
    const revisionKey = `${VERSION}:bootstrap-consumed:${env.CONFIG_REVISION}`;
    const nonceKey = `${VERSION}:bootstrap-nonce:${await digest(envelope.nonce)}`;
    const configKey = `${VERSION}:sealed-config:${env.CONFIG_REVISION}`;
    if (controller.consumed.has(revisionKey) || controller.consumed.has(nonceKey) ||
        await env.STATE.get(revisionKey) !== null || await env.STATE.get(nonceKey) !== null ||
        await env.STATE.get(configKey) !== null) throw new Error('invalid');
    if (!validTimeWindow(envelope.issued_at, envelope.expires_at, Math.floor(Date.now() / 1000), BOOTSTRAP_TTL)) throw new Error('invalid');
    // Burn revision AND nonce before writes; any uncertain outcome requires a fresh revision/nonce.
    controller.consumed.add(revisionKey); controller.consumed.add(nonceKey);
    const tombstone = JSON.stringify({ format: 'lemtel_bootstrap_consumed_v1', version: 1 });
    await env.STATE.put(revisionKey, tombstone);
    await env.STATE.put(nonceKey, tombstone); // No TTL: expiring/deleting config never rearms a revision.
    await env.STATE.put(configKey, JSON.stringify(sealed));
    return json(status('bootstrap', 'bootstrap_accepted'), 201);
  } catch { return json(status('blocked', 'bootstrap_rejected'), 409); }
  finally { controller.running = false; }
}
async function storeStatus(env, value) {
  try {
    if (env.STATE && typeof env.STATE.put === 'function') await env.STATE.put(STATUS_KEY, JSON.stringify(value));
    return value;
  } catch { return status('blocked', 'state_unavailable'); }
}
async function readiness(env, cfg, now) {
  if (cfg.denied) return cfg.denied;
  try {
    const raw = await env.STATE.get(DRILL_KEY);
    const receipt = raw ? (await openState(env, 'drill', raw, now)).payload : null;
    const proof = receipt?.payload;
    if (!proof || proof.format !== 'lemtel_production_destructive_drill_v1' ||
        proof.config_revision !== env.CONFIG_REVISION || proof.writer_role !== 'do_writer' ||
        proof.target_role !== 'hostinger_standby' || proof.writer_droplet_id !== env.DO_WRITER_DROPLET_ID ||
        proof.destructive_drill_validated !== true || proof.serialized_execution_verified !== true ||
        !Number.isSafeInteger(proof.validated_at) || proof.validated_at > now ||
        !Number.isSafeInteger(proof.expires_at) || proof.expires_at <= now ||
        proof.expires_at - proof.validated_at > 86400 ||
        !await verify(env.DRILL_APPROVAL_SECRET, 'lemtel-production-drill-v1', proof, receipt.signature)) {
      return status('blocked', 'production_drill_or_serialization_not_verified');
    }
    return null;
  } catch { return status('blocked', 'state_or_drill_receipt_invalid'); }
}
async function requestJSON(url, options = {}, accepted = [200]) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!accepted.includes(response.status) ||
      !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('untrusted_response');
  return { code: response.status, body: await responseJSON(response) };
}
async function responseJSON(response) {
  // Bound memory and reject truncated, oversized or malformed bodies.
  const reader = response.body.getReader();
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error('response_too_large');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel(); }
  return JSON.parse(text + decoder.decode());
}
function exactL7Response(response, requested) {
  if (response.redirected || !response.url) return false;
  try {
    const actual = new URL(response.url), expected = new URL(requested);
    return actual.protocol === 'https:' && actual.origin === expected.origin &&
      actual.pathname === expected.pathname && !actual.search && !actual.hash;
  } catch { return false; }
}
async function requestL7(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (![200, 404].includes(response.status) || !exactL7Response(response, url)) throw new Error('untrusted_l7_response');
  if (response.status === 404) return { code: 404 };
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('untrusted_l7_response');
  return { code: 200, body: await responseJSON(response) };
}
function healthyL7Marker(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'definitive,format,observed_at,status,writer_role') return false;
  return body.format === 'lemtel_do_writer_l7_ready_v1' && body.writer_role === 'do_writer' &&
    body.definitive === true && Number.isSafeInteger(body.observed_at) &&
    body.observed_at <= now + 15 && now - body.observed_at <= 120 && body.status === 'healthy';
}
function protectedStillValid(env) {
  const now = Math.floor(Date.now() / 1000);
  return validTimeWindow(env.protectedIssuedAt, env.protectedExpiresAt, now, CONFIG_TTL);
}
async function observe(env, cfg, now, lease) {
  try {
    if (!validLease(lease, env) || !protectedStillValid(env)) throw new Error('invalid');
    const observation = await requestL7(cfg.health,
      { headers: { authorization: `Bearer ${env.DO_WRITER_L7_SECRET}` } });
    if (observation.code === 404) return 'unhealthy';
    return healthyL7Marker(observation.body, now) ? 'healthy' : 'ambiguous';
  } catch { return 'ambiguous'; } // Timeout, transport failure and arbitrary 5xx are NOT proof of writer failure.
}
async function provider(env, cfg, path, actionType, lease) {
  if (!validLease(lease, env) || !protectedStillValid(env)) throw new Error('invalid');
  const options = { headers: { authorization: `Bearer ${env.DO_API_TOKEN}`, 'content-type': 'application/json' } };
  if (actionType) { options.method = 'POST'; options.body = JSON.stringify({ type: actionType }); }
  return (await requestJSON(`${cfg.provider}${path}`, options, actionType ? [201, 202] : [200])).body;
}
function validAction(action, env, expectedType, expectedID) {
  return action && Number.isSafeInteger(action.id) && action.id > 0 &&
    String(action.resource_id) === env.DO_WRITER_DROPLET_ID && action.resource_type === 'droplet' &&
    action.type === expectedType && (!expectedID || action.id === expectedID) &&
    ['in-progress', 'completed', 'errored'].includes(action.status);
}
async function persist(env, incident) {
  // The signed command/fence receipt contains a writer identifier; it is never plaintext in KV.
  const sealed = await sealState(env, 'incident', incident, env.protectedIssuedAt, env.protectedExpiresAt);
  await env.STATE.put(INCIDENT_KEY, JSON.stringify(sealed));
}
async function blockIncident(env, incident, reason) {
  incident.phase = 'blocked'; incident.reason = reason;
  await persist(env, incident);
  return storeStatus(env, status('blocked', reason));
}
async function requestFence(env, cfg, incident, type, now, lease) {
  // Persist intent before the one-use Durable Object ledger entry and before any destructive POST.
  if (!validLease(lease, env)) return blockIncident(env, incident, 'serializer_lease_expired');
  incident.phase = type === 'shutdown' ? 'fence_graceful_shutdown_requested' : 'fence_hard_power_off_requested';
  await persist(env, incident);
  if (!await recordSerializedIntent(env, lease, incident.incident_id, type)) {
    return blockIncident(env, incident, 'serializer_incident_refused');
  }
  if (!validLease(lease, env)) return blockIncident(env, incident, 'serializer_lease_expired');
  try {
    const { action } = await provider(env, cfg, `/droplets/${env.DO_WRITER_DROPLET_ID}/actions`, type, lease);
    if (!validAction(action, env, type)) throw new Error('action_invalid');
    incident.action_id = action.id; incident.action_type = type;
    incident.phase = type === 'shutdown' ? 'fence_wait_graceful' : 'fence_wait_hard';
    if (type === 'shutdown') incident.graceful_requested_at = now;
    await persist(env, incident);
    return storeStatus(env, status(incident.phase));
  } catch { return blockIncident(env, incident, 'fence_request_outcome_unknown_manual_review'); }
}
async function pollFence(env, cfg, incident, now, lease) {
  if (!validLease(lease, env)) return blockIncident(env, incident, 'serializer_lease_expired');
  if (now - incident.fencing_started_at > cfg.powerTimeout) return blockIncident(env, incident, 'terminal_power_state_timeout');
  let action, droplet;
  try {
    ({ action } = await provider(env, cfg, `/actions/${incident.action_id}`, undefined, lease));
    ({ droplet } = await provider(env, cfg, `/droplets/${env.DO_WRITER_DROPLET_ID}`, undefined, lease));
    if (!validAction(action, env, incident.action_type, incident.action_id) ||
        String(droplet?.id) !== env.DO_WRITER_DROPLET_ID || !['active', 'off'].includes(droplet.status)) throw new Error('ambiguous');
  } catch { return blockIncident(env, incident, 'provider_terminal_state_ambiguous'); }
  if (droplet.status === 'off' && action.status === 'completed') {
    incident.power_confirmations = (incident.power_confirmations || 0) + 1;
    incident.phase = incident.power_confirmations >= 2 ? 'fence_verified' : 'fence_poll_terminal';
    incident.terminal_observed_at = now;
    await persist(env, incident);
    return storeStatus(env, status(incident.phase));
  }
  if (['fence_poll_terminal', 'fence_verified'].includes(incident.phase)) return blockIncident(env, incident, 'terminal_power_state_changed');
  if (incident.phase === 'fence_wait_graceful' && now - incident.graceful_requested_at >= cfg.grace) {
    return requestFence(env, cfg, incident, 'power_off', now, lease);
  }
  if (incident.phase === 'fence_wait_hard' && action.status === 'errored') return blockIncident(env, incident, 'hard_fence_failed');
  await persist(env, incident);
  return storeStatus(env, status(incident.phase));
}
async function issueCommand(env, cfg, incident, now, lease) {
  // A fresh terminal poll is mandatory even if a previous tick said fence_verified.
  if (!validLease(lease, env)) return blockIncident(env, incident, 'serializer_lease_expired');
  const checked = await pollFence(env, cfg, incident, now, lease);
  if (checked.state !== 'fence_verified') return checked;
  if (!protectedStillValid(env)) return blockIncident(env, incident, 'protected_configuration_unavailable');
  if (incident.last_definitive_observation !== 'unhealthy' || incident.failure_cycles < cfg.cycles ||
      incident.power_confirmations < 2 || now - incident.terminal_observed_at > cfg.interval) {
    return blockIncident(env, incident, 'fence_receipt_prerequisites_missing');
  }
  if (!await recordSerializedIntent(env, lease, incident.incident_id, 'promotion')) {
    return blockIncident(env, incident, 'serializer_incident_refused');
  }
  if (!validLease(lease, env)) return blockIncident(env, incident, 'serializer_lease_expired');
  const fencePayload = { format: 'lemtel_do_writer_fence_receipt_v1', incident_id: incident.incident_id,
    writer_role: 'do_writer', writer_droplet_id: env.DO_WRITER_DROPLET_ID,
    provider_action_id: incident.action_id, provider_action_type: incident.action_type,
    terminal_action_status: 'completed', terminal_power_state: 'off', confirmations: incident.power_confirmations,
    observed_at: incident.terminal_observed_at };
  const fence_receipt = { payload: fencePayload,
    signature: await sign(env.AGENT_SHARED_SECRET, 'lemtel-fence-receipt-v1', fencePayload) };
  const payload = { format: 'lemtel_promotion_command_v1', name: 'promotion', incident_id: incident.incident_id,
    nonce: crypto.randomUUID(), writer_role: 'do_writer', target_role: 'hostinger_standby',
    issued_at: now, expires_at: now + cfg.ttl, fence_receipt };
  incident.command = { payload, signature: await sign(env.AGENT_SHARED_SECRET, 'lemtel-promotion-command-v1', payload) };
  incident.phase = 'promotion_command_ready';
  await persist(env, incident);
  return storeStatus(env, status(incident.phase, 'manual_promotion_action_required'));
}
async function tick(env) {
  if (env.FAILOVER_MODE === 'bootstrap') return status('bootstrap', 'configuration_injection_only');
  if (env.FAILOVER_MODE !== 'active') return status('disabled_or_dry_run');
  const now = Math.floor(Date.now() / 1000), cfg = await config(env, now);
  if (cfg.runtime) env = cfg.runtime;
  // Local overlap denial is only an optimisation; the Durable Object lease is the cross-isolate authority.
  if (tickRunning) return await storeStatus(env, status('blocked', 'overlapping_tick'));
  tickRunning = true;
  try {
    const lease = await acquireLease(env);
    if (!lease) return await storeStatus(env, status('blocked', 'serializer_lease_unavailable'));
    const denied = await readiness(env, cfg, now);
    if (denied) return await storeStatus(env, denied);
    const raw = await env.STATE.get(INCIDENT_KEY);
    let incident = raw ? (await openState(env, 'incident', raw, now)).payload : { version: VERSION, config_revision: env.CONFIG_REVISION,
      phase: 'observation', failure_cycles: 0, last_cycle_at: 0 };
    if (incident.version !== VERSION || incident.config_revision !== env.CONFIG_REVISION) {
      return await storeStatus(env, status('blocked', 'incident_configuration_mismatch'));
    }
    if (incident.phase === 'blocked') return await storeStatus(env, status('blocked', incident.reason));
    if (['fence_graceful_shutdown_requested', 'fence_hard_power_off_requested'].includes(incident.phase)) {
      return await blockIncident(env, incident, 'persisted_fence_intent_requires_manual_reconciliation');
    }
    if (now < incident.last_cycle_at || now - incident.last_cycle_at < cfg.interval) {
      return await storeStatus(env, status('cycle_not_due'));
    }
    incident.last_cycle_at = now;
    if (['observation', 'incident_suspected'].includes(incident.phase)) {
      const observation = await observe(env, cfg, now, lease);
      incident.last_definitive_observation = observation;
      if (observation !== 'unhealthy') {
        incident.phase = 'observation'; incident.failure_cycles = 0; delete incident.incident_id;
        await persist(env, incident);
        return await storeStatus(env, status(observation === 'ambiguous' ? 'blocked' : 'healthy',
          observation === 'ambiguous' ? 'l7_health_ambiguous_no_fencing' : 'writer_healthy'));
      }
      if (!incident.incident_id) incident.incident_id = crypto.randomUUID();
      incident.failure_cycles += 1; incident.phase = 'incident_suspected';
      if (incident.failure_cycles < cfg.cycles) {
        await persist(env, incident); return await storeStatus(env, status(incident.phase));
      }
      incident.fencing_started_at = now;
      return await requestFence(env, cfg, incident, 'shutdown', now, lease);
    }
    if (['fence_wait_graceful', 'fence_wait_hard', 'fence_poll_terminal'].includes(incident.phase)) {
      return await pollFence(env, cfg, incident, now, lease);
    }
    if (incident.phase === 'fence_verified') return await issueCommand(env, cfg, incident, now, lease);
    if (incident.phase === 'promotion_command_ready') {
      if (incident.command.payload.expires_at <= now) return await blockIncident(env, incident, 'promotion_command_expired');
      await persist(env, incident); return await storeStatus(env, status(incident.phase, 'manual_promotion_action_required'));
    }
    if (incident.phase === 'promotion_command_dispatched') {
      return await storeStatus(env, status('manual_promotion_action_required'));
    }
    return await blockIncident(env, incident, 'unknown_phase');
  } catch { return await storeStatus(env, status('blocked', 'state_or_protocol_error_manual_review')); }
  finally { tickRunning = false; }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname, now = Math.floor(Date.now() / 1000);
    if (env.FAILOVER_MODE === 'bootstrap') return bootstrap(request, env, path, now);
    if (path === BOOTSTRAP_KEY_PATH || path === BOOTSTRAP_PATH) return json(status('blocked', 'not_found'), 404);
    // Disabled/unknown modes cannot contact a Durable Object, KV, provider, or command channel.
    if (env.FAILOVER_MODE !== 'active') return json(status('disabled_or_dry_run'));
    // No HTTP route exposes a promotion command. HTTP is status-only in active mode.
    if (request.method !== 'GET') return json(status('blocked', 'method_not_allowed'), 405);
    if (path !== '/healthz' && path !== '/status') return json(status('blocked', 'not_found'), 404);
    const cfg = await config(env, now);
    if (cfg.runtime) env = cfg.runtime;
    // Do not mint a lease for a read-only status request, but missing/invalid binding remains fail-closed.
    if (!serializerStub(env)) {
      const saved = await storeStatus(env, status('blocked', 'serializer_lease_unavailable'));
      return json(saved, 409);
    }
    const denied = await readiness(env, cfg, now);
    if (denied) {
      const saved = await storeStatus(env, denied);
      return json(saved, saved.state === 'blocked' ? 409 : 200);
    }
    try {
      const saved = JSON.parse(await env.STATE.get(STATUS_KEY) || 'null');
      return json(saved ? status(saved.state, saved.reason) : status('observation'));
    } catch { return json(status('blocked', 'state_unavailable'), 503); }
  },
  async scheduled(_controller, env, ctx) {
    const task = tick(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
