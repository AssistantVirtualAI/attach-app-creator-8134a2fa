// Operator tool: switches the failover arbiter between `disabled` and `active`, nothing else.
// Every other binding is strictly inherited (STATE, ARBITER_SERIALIZER, CONFIG_REVISION, state key), the
// Worker source must match the reviewed digest, and the result is confirmed through the public /status.
// `active` is refused unless a sealed configuration and a drill authorization exist for the current revision.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_NAME = 'lemtel-failover-arbiter';
export const SOURCE_PATH = resolve(fileURLToPath(new URL('..', import.meta.url)),
  'infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs');
const MAIN = 'lemtel-failover-arbiter-worker.mjs';
const INHERITED = ['STATE', 'ARBITER_SERIALIZER', 'CONFIG_REVISION', 'CONFIG_STATE_ENCRYPTION_KEY'];
export class ModeGateError extends Error { constructor(code) { super(code); this.code = code; } }
const gate = (ok, code) => { if (!ok) throw new ModeGateError(code); };

export async function switchMode({ env = process.env, fetchImpl = globalThis.fetch, readSource = (p) => readFile(p),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const target = env.LEMTEL_ARBITER_TARGET_MODE;
  gate(target === 'active' || target === 'disabled', 'target_mode_invalid');
  gate(env.LEMTEL_ARBITER_MODE_INTENT === `LEMTEL_ARBITER_MODE_${target.toUpperCase()}_V1`, 'intent_required');
  gate(/^[a-f0-9]{32}$/u.test(env.LEMTEL_CF_TARGET_ACCOUNT_ID || ''), 'account_id_invalid');
  gate(/^[a-f0-9]{64}$/u.test(env.LEMTEL_CF_EXPECTED_SOURCE_SHA256 || ''), 'source_sha256_invalid');
  gate(/^\d{4}-\d{2}-\d{2}$/u.test(env.LEMTEL_CF_COMPATIBILITY_DATE || ''), 'compatibility_date_invalid');
  gate(typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.length >= 20, 'cloudflare_token_required');
  let origin; try { origin = new URL(env.LEMTEL_ARBITER_ORIGIN || ''); } catch { origin = null; }
  gate(origin && origin.protocol === 'https:' && origin.pathname === '/' && origin.hostname.startsWith(`${WORKER_NAME}.`) &&
    origin.hostname.endsWith('.workers.dev'), 'arbiter_origin_invalid');
  const source = await readSource(SOURCE_PATH);
  gate(createHash('sha256').update(source).digest('hex') === env.LEMTEL_CF_EXPECTED_SOURCE_SHA256, 'source_sha256_mismatch');
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.LEMTEL_CF_TARGET_ACCOUNT_ID}`;
  const cf = async (path, init = {}, code = 'cloudflare_request_failed') => {
    let response; try { response = await fetchImpl(`${base}${path}`, { ...init, redirect: 'error',
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, ...(init.headers || {}) } }); } catch { throw new ModeGateError(code); }
    const payload = await response.json().catch(() => null); gate(response.ok && payload?.success === true, code); return payload.result;
  };
  const settings = await cf(`/workers/scripts/${WORKER_NAME}/settings`, {}, 'settings_read_failed');
  const byName = new Map((settings.bindings || []).map((b) => [b.name, b]));
  gate([...byName.keys()].sort().join(',') === [...INHERITED, 'FAILOVER_MODE'].sort().join(','), 'remote_bindings_unexpected');
  gate(byName.get('ARBITER_SERIALIZER').type === 'durable_object_namespace' && byName.get('ARBITER_SERIALIZER').class_name === 'LemtelFailoverSerializer', 'remote_serializer_invalid');
  gate(byName.get('CONFIG_STATE_ENCRYPTION_KEY').type === 'secret_text', 'remote_state_key_invalid');
  const current = byName.get('FAILOVER_MODE').text, revision = byName.get('CONFIG_REVISION').text;
  gate(['disabled', 'active'].includes(current), 'remote_mode_unexpected');
  log(`arbiter_mode_before=${current}`);
  if (target === 'active') {
    const ns = byName.get('STATE').namespace_id;
    gate(/^[a-f0-9]{32}$/u.test(ns || ''), 'state_namespace_unresolved');
    for (const key of [`lemtel_failover_execution_v1:sealed-config:${revision}`, 'lemtel_failover_execution_v1:production-drill']) {
      let response; try { response = await fetchImpl(`${base}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,
        { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error' }); } catch { response = null; }
      gate(response?.status === 200, key.endsWith('production-drill') ? 'drill_authorization_missing' : 'sealed_configuration_missing');
      const record = JSON.parse(await response.text());
      gate(record.config_revision === revision && record.expires_at > Math.floor(Date.now() / 1000), 'authorization_expired_or_other_revision');
    }
  }
  if (current !== target) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: MAIN, compatibility_date: env.LEMTEL_CF_COMPATIBILITY_DATE,
      bindings: [...INHERITED.map((name) => ({ name, type: 'inherit' })), { name: 'FAILOVER_MODE', type: 'plain_text', text: target }] })],
      { type: 'application/json' }), 'metadata.json');
    form.append(MAIN, new Blob([source], { type: 'application/javascript+module' }), MAIN);
    const version = await cf(`/workers/scripts/${WORKER_NAME}/versions?bindings_inherit=strict`, { method: 'POST', body: form }, 'version_upload_failed');
    await cf(`/workers/scripts/${WORKER_NAME}/deployments`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: version.id, percentage: 100 }] }) }, 'deployment_failed');
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const status = await (await fetchImpl(`${origin.origin}/status`, { redirect: 'error' })).json();
      if (target === 'disabled' ? status.state === 'disabled_or_dry_run' : status.state !== 'disabled_or_dry_run') {
        log(`arbiter_mode_after=${target}`); log(`arbiter_status=${status.state}/${status.reason}`); return { mode: target, status };
      }
    } catch { /* propagation */ }
    await sleep(3000);
  }
  throw new ModeGateError('mode_not_confirmed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  switchMode({ log: (line) => console.info(line) }).then(() => console.info('arbiter_mode_status=complete'))
    .catch((error) => { console.error(`arbiter_mode_status=blocked\nreason=${error instanceof ModeGateError ? error.code : 'unexpected_error'}`); process.exitCode = 1; });
}
