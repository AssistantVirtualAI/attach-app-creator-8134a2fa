// Prepared protocol only: no deployment, secrets, bindings or production approvals included.
// KV is NOT a transactional lock. Production serialization must be reviewed separately.
const VERSION = 'lemtel_failover_execution_v1';
const STATUS_KEY = `${VERSION}:status`;
const INCIDENT_KEY = `${VERSION}:incident`;
const DRILL_KEY = `${VERSION}:production-drill`;
const ROUTING_ENABLED = false; // Routing is a separate revision, never an env toggle here.
let tickRunning = false;

function status(state, reason = state) {
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
  function config(env) {
  if (env.FAILOVER_MODE !== 'active') return { denied: status('disabled_or_dry_run') };
  const missing = [];
  for (const name of ['DO_API_TOKEN', 'AGENT_SHARED_SECRET', 'DO_WRITER_L7_SECRET', 'DRILL_APPROVAL_SECRET']) {
    if (typeof env[name] !== 'string' || env[name].length < 32) missing.push(name);
  }
  if (!/^[1-9]\d*$/.test(env.DO_WRITER_DROPLET_ID || '')) missing.push('DO_WRITER_DROPLET_ID');
  if (!env.STATE || typeof env.STATE.get !== 'function' || typeof env.STATE.put !== 'function') missing.push('STATE');
  const provider = httpsURL(env.DO_API_BASE_URL);
  const health = l7URL(env.DO_WRITER_L7_URL);
  if (!provider || !provider.endsWith('/v2')) missing.push('DO_API_BASE_URL');
  if (!health || health === provider || health.startsWith(`${provider}/`)) missing.push('DO_WRITER_L7_URL');
  if (!/^[a-z0-9-]{8,80}$/.test(env.CONFIG_REVISION || '')) missing.push('CONFIG_REVISION');
  if (env.ARBITER_SERIALIZATION_ACK !== 'reviewed_single_serialized_scheduler') missing.push('ARBITER_SERIALIZATION_ACK');
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
  return missing.length ? { denied: status('blocked', 'active_configuration_incomplete'), missing } :
    { provider, health, interval, cycles, grace, powerTimeout, ttl };
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
    const receipt = raw ? JSON.parse(raw) : null;
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
async function observe(env, cfg, now) {
  try {
    const observation = await requestL7(cfg.health,
      { headers: { authorization: `Bearer ${env.DO_WRITER_L7_SECRET}` } });
    if (observation.code === 404) return 'unhealthy';
    return healthyL7Marker(observation.body, now) ? 'healthy' : 'ambiguous';
  } catch { return 'ambiguous'; } // Timeout, transport failure and arbitrary 5xx are NOT proof of writer failure.
}
async function provider(env, cfg, path, actionType) {
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
async function persist(env, incident) { await env.STATE.put(INCIDENT_KEY, JSON.stringify(incident)); }
async function blockIncident(env, incident, reason) {
  incident.phase = 'blocked'; incident.reason = reason;
  await persist(env, incident);
  return storeStatus(env, status('blocked', reason));
}
async function requestFence(env, cfg, incident, type, now) {
  // Persist intent BEFORE any destructive request. An uncertain/crashed POST is never retried automatically.
  incident.phase = type === 'shutdown' ? 'fence_graceful_shutdown_requested' : 'fence_hard_power_off_requested';
  await persist(env, incident);
  try {
    const { action } = await provider(env, cfg, `/droplets/${env.DO_WRITER_DROPLET_ID}/actions`, type);
    if (!validAction(action, env, type)) throw new Error('action_invalid');
    incident.action_id = action.id; incident.action_type = type;
    incident.phase = type === 'shutdown' ? 'fence_wait_graceful' : 'fence_wait_hard';
    if (type === 'shutdown') incident.graceful_requested_at = now;
    await persist(env, incident);
    return storeStatus(env, status(incident.phase));
  } catch { return blockIncident(env, incident, 'fence_request_outcome_unknown_manual_review'); }
}
async function pollFence(env, cfg, incident, now) {
  if (now - incident.fencing_started_at > cfg.powerTimeout) return blockIncident(env, incident, 'terminal_power_state_timeout');
  let action, droplet;
  try {
    ({ action } = await provider(env, cfg, `/actions/${incident.action_id}`));
    ({ droplet } = await provider(env, cfg, `/droplets/${env.DO_WRITER_DROPLET_ID}`));
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
    return requestFence(env, cfg, incident, 'power_off', now);
  }
  if (incident.phase === 'fence_wait_hard' && action.status === 'errored') return blockIncident(env, incident, 'hard_fence_failed');
  await persist(env, incident);
  return storeStatus(env, status(incident.phase));
}
async function issueCommand(env, cfg, incident, now) {
  // A fresh terminal poll is mandatory even if a previous tick said fence_verified.
  const checked = await pollFence(env, cfg, incident, now);
  if (checked.state !== 'fence_verified') return checked;
  if (incident.last_definitive_observation !== 'unhealthy' || incident.failure_cycles < cfg.cycles ||
      incident.power_confirmations < 2 || now - incident.terminal_observed_at > cfg.interval) {
    return blockIncident(env, incident, 'fence_receipt_prerequisites_missing');
  }
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
  const cfg = config(env), now = Math.floor(Date.now() / 1000);
  const denied = await readiness(env, cfg, now);
  if (denied) return await storeStatus(env, denied);
  if (tickRunning) return await storeStatus(env, status('blocked', 'overlapping_tick'));
  tickRunning = true;
  try {
    const raw = await env.STATE.get(INCIDENT_KEY);
    let incident = raw ? JSON.parse(raw) : { version: VERSION, config_revision: env.CONFIG_REVISION,
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
      const observation = await observe(env, cfg, now);
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
      return await requestFence(env, cfg, incident, 'shutdown', now);
    }
    if (['fence_wait_graceful', 'fence_wait_hard', 'fence_poll_terminal'].includes(incident.phase)) {
      return await pollFence(env, cfg, incident, now);
    }
    if (incident.phase === 'fence_verified') return await issueCommand(env, cfg, incident, now);
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
async function authenticated(request, secret) {
  // Compare fixed-size digests, not the raw secret. Never log request headers.
  const supplied = request.headers.get('authorization') || '';
  if (!supplied.startsWith('Bearer ') || supplied.length > 4096) return false;
  const expected = await sign(secret, 'lemtel-agent-auth-v1', 'authenticate');
  return verify(supplied.slice(7), 'lemtel-agent-auth-v1', 'authenticate', expected);
}

export default {
  async fetch(request, env) {
    const cfg = config(env), now = Math.floor(Date.now() / 1000);
    const denied = await readiness(env, cfg, now);
    if (denied) {
      const saved = await storeStatus(env, denied);
      return json(saved, saved.state === 'blocked' ? 409 : 200);
    }
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET') return json(status('blocked', 'method_not_allowed'), 405);
    if (path === '/healthz' || path === '/status') {
      try { return json(JSON.parse(await env.STATE.get(STATUS_KEY) || 'null') || status('observation')); }
      catch { return json(status('blocked', 'state_unavailable'), 503); }
    }
    if (path !== '/agent/command') return json(status('blocked', 'not_found'), 404);
    if (!await authenticated(request, env.AGENT_SHARED_SECRET)) return json(status('blocked', 'unauthorized'), 401);
    try {
      const incident = JSON.parse(await env.STATE.get(INCIDENT_KEY) || 'null');
      if (!incident || incident.phase !== 'promotion_command_ready') return json({ state: 'no_command' });
      if (incident.version !== VERSION || incident.config_revision !== env.CONFIG_REVISION ||
          incident.command.payload.expires_at <= now) {
        await blockIncident(env, incident, 'promotion_command_expired_or_configuration_changed');
        return json(status('blocked', 'promotion_command_invalid'), 409);
      }
      const command = incident.command;
      // At-most-once delivery intention, not a KV CAS guarantee. The agent's durable incident ledger is authoritative.
      incident.phase = 'promotion_command_dispatched'; delete incident.command;
      await persist(env, incident);
      await env.STATE.put(STATUS_KEY, JSON.stringify(status('manual_promotion_action_required')));
      return json({ state: 'command_available', command });
    } catch { return json(status('blocked', 'command_delivery_unknown_manual_review'), 503); }
  },
  async scheduled(_controller, env, ctx) {
    const task = tick(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
