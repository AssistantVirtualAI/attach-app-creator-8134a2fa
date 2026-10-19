// Operator tool: injects the sealed configuration into the failover arbiter, then returns it to `disabled`.
// It never sets `active`. Every secret is generated or received in memory, sent only to Cloudflare (sealed),
// to the Hostinger agent configuration (agent secret, over the supplied SSH command) and to the operator's
// macOS Keychain (drill approval secret). Nothing secret is printed, logged or written to disk here.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectBootstrapConfiguration, createBootstrapSession, protocol, sealDrillReceipt, canonical }
  from '../infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs';

export const WORKER_NAME = 'lemtel-failover-arbiter';
export const INTENT = 'LEMTEL_CF_BOOTSTRAP_SEALED_CONFIG_V1';
export const SOURCE_PATH = resolve(fileURLToPath(new URL('..', import.meta.url)),
  'infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs');
export const MAIN_MODULE = 'lemtel-failover-arbiter-worker.mjs';
export const CRON = '* * * * *';
export const CONFIG_TTL_SECONDS = 89 * 86400;
export const POLICY = Object.freeze({
  DO_API_BASE_URL: 'https://api.digitalocean.com/v2',
  DO_WRITER_L7_URL: 'https://lemtel.assistantvirtualai.com/lemtel-lb-ready',
  OBSERVATION_INTERVAL_SECONDS: '60',
  INCIDENT_FAILURE_CYCLES: '5',
  GRACEFUL_SHUTDOWN_DELAY_SECONDS: '120',
  POWER_STATE_TIMEOUT_SECONDS: '900',
  COMMAND_TTL_SECONDS: '300',
});

export class BootstrapGateError extends Error {
  constructor(code) { super(code); this.name = 'BootstrapGateError'; this.code = code; }
}
const gate = (condition, code) => { if (!condition) throw new BootstrapGateError(code); };
const secret = () => randomBytes(32).toString('base64url');

export function readGates(env) {
  gate(env.LEMTEL_CF_BOOTSTRAP_INTENT === INTENT, 'intent_required');
  gate(/^[a-f0-9]{32}$/u.test(env.LEMTEL_CF_TARGET_ACCOUNT_ID || ''), 'account_id_invalid');
  gate(/^[a-f0-9]{64}$/u.test(env.LEMTEL_CF_EXPECTED_SOURCE_SHA256 || ''), 'source_sha256_invalid');
  gate(/^\d{4}-\d{2}-\d{2}$/u.test(env.LEMTEL_CF_COMPATIBILITY_DATE || ''), 'compatibility_date_invalid');
  gate(/^lemtel-failover-[a-z0-9-]{4,60}$/u.test(env.LEMTEL_CF_CONFIG_REVISION || ''), 'config_revision_invalid');
  gate(/^[1-9]\d{0,19}$/u.test(env.LEMTEL_DO_WRITER_DROPLET_ID || ''), 'droplet_id_invalid');
  let origin;
  try { origin = new URL(env.LEMTEL_ARBITER_ORIGIN || ''); } catch { origin = null; }
  gate(origin && origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.hash &&
    origin.hostname.endsWith('.workers.dev') && origin.hostname.startsWith(`${WORKER_NAME}.`), 'arbiter_origin_invalid');
  gate(typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.length >= 20, 'cloudflare_token_required');
  gate(typeof env.LEMTEL_DO_ARBITER_TOKEN === 'string' && env.LEMTEL_DO_ARBITER_TOKEN.length >= 32, 'do_token_required');
  let agentCommand, drillCommand;
  try { agentCommand = JSON.parse(env.LEMTEL_AGENT_CONFIG_CMD || ''); drillCommand = JSON.parse(env.LEMTEL_DRILL_SECRET_CMD || ''); }
  catch { throw new BootstrapGateError('sink_commands_invalid'); }
  gate(Array.isArray(agentCommand) && agentCommand.length > 0 && agentCommand.every((part) => typeof part === 'string'), 'agent_sink_invalid');
  gate(Array.isArray(drillCommand) && drillCommand.length > 0 && drillCommand.every((part) => typeof part === 'string'), 'drill_sink_invalid');
  gate(typeof env.LEMTEL_AGENT_CONFIG_REMOTE_SCRIPT === 'string' && env.LEMTEL_AGENT_CONFIG_REMOTE_SCRIPT.startsWith('/'), 'agent_remote_script_invalid');
  // Optional, explicit: a short supervised-drill authorization (1–4 h) written right after the bootstrap.
  const drill = env.LEMTEL_DRILL_AUTHORIZATION || 'none';
  const match = /^supervised_review_drill:([1-4])$/u.exec(drill);
  gate(drill === 'none' || match, 'drill_authorization_invalid');
  return { accountId: env.LEMTEL_CF_TARGET_ACCOUNT_ID, sourceSha256: env.LEMTEL_CF_EXPECTED_SOURCE_SHA256,
    compatibilityDate: env.LEMTEL_CF_COMPATIBILITY_DATE, revision: env.LEMTEL_CF_CONFIG_REVISION,
    dropletId: env.LEMTEL_DO_WRITER_DROPLET_ID, origin: origin.origin, cfToken: env.CLOUDFLARE_API_TOKEN,
    doToken: env.LEMTEL_DO_ARBITER_TOKEN, agentCommand, drillCommand, agentRemoteScript: env.LEMTEL_AGENT_CONFIG_REMOTE_SCRIPT,
    drillHours: match ? Number(match[1]) : 0 };
}

export function versionMetadata(compatibilityDate, bindings) {
  return { main_module: MAIN_MODULE, compatibility_date: compatibilityDate, bindings };
}
export function bootstrapBindings(session) {
  return [
    { name: 'STATE', type: 'inherit' }, { name: 'ARBITER_SERIALIZER', type: 'inherit' },
    { name: 'FAILOVER_MODE', type: 'plain_text', text: 'bootstrap' },
    { name: 'CONFIG_REVISION', type: 'plain_text', text: session.textBindings.CONFIG_REVISION },
    { name: 'CONFIG_DECRYPTION_PUBLIC_JWK', type: 'plain_text', text: session.textBindings.CONFIG_DECRYPTION_PUBLIC_JWK },
    ...['CONFIG_DECRYPTION_PRIVATE_JWK', 'BOOTSTRAP_AUTH_SECRET', 'CONFIG_STATE_ENCRYPTION_KEY']
      .map((name) => ({ name, type: 'secret_text', text: session.secretBindings[name] })),
  ];
}
export function disabledBindings(revision, keyProvisioned) {
  return [
    { name: 'STATE', type: 'inherit' }, { name: 'ARBITER_SERIALIZER', type: 'inherit' },
    { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
    keyProvisioned ? { name: 'CONFIG_REVISION', type: 'plain_text', text: revision } : { name: 'CONFIG_REVISION', type: 'inherit' },
    ...(keyProvisioned ? [{ name: 'CONFIG_STATE_ENCRYPTION_KEY', type: 'inherit' }] : []),
  ];
}
export function assertStartingSettings(result, revision) {
  const bindings = result?.bindings;
  gate(Array.isArray(bindings), 'settings_invalid');
  const byName = new Map(bindings.map((binding) => [binding.name, binding]));
  gate(byName.size === bindings.length, 'settings_invalid');
  const allowed = new Set(['STATE', 'FAILOVER_MODE', 'CONFIG_REVISION', 'ARBITER_SERIALIZER', 'CONFIG_STATE_ENCRYPTION_KEY']);
  gate([...byName.keys()].every((name) => allowed.has(name)) && ['STATE', 'FAILOVER_MODE', 'CONFIG_REVISION', 'ARBITER_SERIALIZER']
    .every((name) => byName.has(name)), 'remote_bindings_unexpected');
  gate(byName.get('FAILOVER_MODE').type === 'plain_text' && byName.get('FAILOVER_MODE').text === 'disabled', 'remote_mode_not_disabled');
  gate(byName.get('ARBITER_SERIALIZER').type === 'durable_object_namespace' &&
    byName.get('ARBITER_SERIALIZER').class_name === 'LemtelFailoverSerializer', 'remote_serializer_invalid');
  gate(byName.get('CONFIG_REVISION').text !== revision, 'config_revision_must_be_new');
}
export function assertFinalSettings(result, revision) {
  const names = (result?.bindings || []).map((binding) => binding.name).sort();
  gate(names.join(',') === ['ARBITER_SERIALIZER', 'CONFIG_REVISION', 'CONFIG_STATE_ENCRYPTION_KEY', 'FAILOVER_MODE', 'STATE'].join(','), 'final_bindings_unexpected');
  const byName = new Map(result.bindings.map((binding) => [binding.name, binding]));
  gate(byName.get('FAILOVER_MODE').text === 'disabled', 'final_mode_not_disabled');
  gate(byName.get('CONFIG_REVISION').text === revision, 'final_revision_mismatch');
}
export function agentConfiguration({ origin, agentSecret, dropletId }) {
  return ['FAILOVER_MODE=active', `ARBITER_URL=${origin}`, `AGENT_SHARED_SECRET=${agentSecret}`,
    `DO_WRITER_DROPLET_ID=${dropletId}`, 'LEMTEL_HA_LOCAL_POSTGRES_CONTAINER=lemtel-postgres-hostinger-standby',
    'PROMOTION_EXECUTION_MODE=review', ''].join('\n');
}

function runSink(spawnImpl, argv, input, success) {
  return new Promise((done) => {
    let output = '';
    let child;
    try { child = spawnImpl(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { done({ ok: false, output: '' }); return; }
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', () => {});
    child.on('error', () => done({ ok: false, output }));
    child.on('close', (code) => done({ ok: code === 0 && (!success || output.includes(success)), output }));
    child.stdin.end(input);
  });
}

export async function runBootstrap({ env = process.env, fetchImpl = globalThis.fetch, spawnImpl = spawn,
  readSource = (path) => readFile(path), sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = () => Math.floor(Date.now() / 1000), log = () => {} } = {}) {
  const g = readGates(env);
  const source = await readSource(SOURCE_PATH);
  gate(createHash('sha256').update(source).digest('hex') === g.sourceSha256, 'source_sha256_mismatch');
  const cf = async (path, init = {}, code = 'cloudflare_request_failed') => {
    let response;
    try { response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${g.accountId}/workers/scripts/${WORKER_NAME}${path}`,
      { ...init, headers: { authorization: `Bearer ${g.cfToken}`, ...(init.headers || {}) }, redirect: 'error' }); }
    catch { throw new BootstrapGateError(code); }
    const payload = await response.json().catch(() => null);
    gate(response.ok && payload?.success === true, code);
    return payload.result;
  };
  const deploy = async (bindings, code) => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(versionMetadata(g.compatibilityDate, bindings))], { type: 'application/json' }), 'metadata.json');
    form.append(MAIN_MODULE, new Blob([source], { type: 'application/javascript+module' }), MAIN_MODULE);
    const version = await cf('/versions?bindings_inherit=strict', { method: 'POST', body: form }, code);
    gate(/^[0-9a-f-]{36}$/iu.test(version?.id || ''), code);
    await cf('/deployments', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: version.id, percentage: 100 }] }) }, code);
  };
  const arbiter = (path, init = {}) => fetchImpl(`${g.origin}${path}`, { ...init, redirect: 'error' });

  // 1. DigitalOcean token can read exactly the writer droplet (no action is ever requested here).
  let droplet;
  try {
    const response = await fetchImpl(`${POLICY.DO_API_BASE_URL}/droplets/${g.dropletId}`,
      { headers: { authorization: `Bearer ${g.doToken}` }, redirect: 'error' });
    droplet = response.ok ? (await response.json()).droplet : null;
  } catch { droplet = null; }
  gate(String(droplet?.id) === g.dropletId && droplet?.status === 'active', 'do_token_cannot_read_active_writer');
  log('do_token=reads_active_writer');
  // 2. Arbiter is disabled with the expected bindings, and the revision is new.
  assertStartingSettings(await cf('/settings', {}, 'settings_read_failed'), g.revision);
  log('arbiter_preflight=disabled_expected_bindings');
  // 3. One observation per minute (the cron only wakes the Worker; disabled mode does nothing).
  const schedules = await cf('/schedules', {}, 'schedules_read_failed');
  if (!(schedules?.schedules?.length === 1 && schedules.schedules[0].cron === CRON)) {
    await cf('/schedules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ cron: CRON }]) }, 'schedules_update_failed');
  }
  log('arbiter_cron=every_minute');
  // 4. Secrets in memory; the drill approval secret goes to the operator's Keychain BEFORE any Cloudflare change.
  const agentSecret = secret(), drillSecret = secret();
  const configuration = { ...POLICY, DO_API_TOKEN: g.doToken, AGENT_SHARED_SECRET: agentSecret,
    DO_WRITER_L7_SECRET: secret(), DRILL_APPROVAL_SECRET: drillSecret, DO_WRITER_DROPLET_ID: g.dropletId };
  const keychain = await runSink(spawnImpl, g.drillCommand,
    `add-generic-password -U -a lemtel -s lemtel-failover-drill-approval-${g.revision} -w ${drillSecret}\n`);
  const stored = await runSink(spawnImpl, g.drillCommand,
    `find-generic-password -a lemtel -s lemtel-failover-drill-approval-${g.revision}\n`, 'keychain:');
  gate(keychain.ok && stored.ok, 'drill_secret_keychain_failed');
  log('drill_approval_secret=stored_in_keychain');
  // 5. Sealed bootstrap: bootstrap mode only for the injection, then disabled in all cases.
  const session = await createBootstrapSession(g.revision);
  let keyProvisioned = false;
  const result = await injectBootstrapConfiguration({ session, configuration, now: now(), configTTL: CONFIG_TTL_SECONDS,
    enterBootstrap: async () => {
      await deploy(bootstrapBindings(session), 'bootstrap_version_failed');
      keyProvisioned = true;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const response = await arbiter(protocol.keyPath);
          if (response.status === 200 && (await response.json()).kid === session.publicDescriptor.kid) return;
        } catch { /* propagation */ }
        await sleep(3000);
      }
      throw new BootstrapGateError('bootstrap_key_not_served');
    },
    transport: ({ method, path, headers, body }) => arbiter(path, { method, headers, body }),
    returnToDisabled: async () => {
      await deploy(disabledBindings(g.revision, keyProvisioned), 'disabled_version_failed');
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const response = await arbiter('/status');
          if (response.status === 200 && (await response.json()).state === 'disabled_or_dry_run') return;
        } catch { /* propagation */ }
        await sleep(3000);
      }
      throw new BootstrapGateError('disabled_not_confirmed');
    },
  });
  gate(result.state === 'bootstrap_injected' && result.failover_mode === 'disabled', 'bootstrap_not_accepted');
  assertFinalSettings(await cf('/settings', {}, 'settings_read_failed'), g.revision);
  log('arbiter_sealed_configuration=injected');
  log('arbiter_mode=disabled_confirmed');
  // 6. Hostinger agent configuration (agent secret only), validated by the agent's own preflight.
  const remote = await readFile(g.agentRemoteScript, 'utf8');
  const agent = await runSink(spawnImpl, g.agentCommand, `${remote.endsWith('\n') ? remote : `${remote}\n`}${agentConfiguration({ origin: g.origin, agentSecret, dropletId: g.dropletId })}`,
    'agent_config_status=complete');
  log(agent.ok ? 'hostinger_agent_config=written_preflight_ready' : 'hostinger_agent_config=failed_rerun_with_new_revision');
  gate(agent.ok, 'hostinger_agent_config_failed');
  // 7. Optional supervised-drill authorization: signed with the drill secret, sealed with the state key, both
  //    only in memory, written to the arbiter KV. It never changes the mode (still disabled).
  if (g.drillHours) {
    const issued = now();
    const payload = { format: 'lemtel_production_destructive_drill_v1', config_revision: g.revision,
      writer_role: 'do_writer', target_role: 'hostinger_standby', writer_droplet_id: g.dropletId,
      destructive_drill_validated: true, serialized_execution_verified: true,
      authorization_kind: 'supervised_review_drill', validated_at: issued, expires_at: issued + g.drillHours * 3600 };
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(drillSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(`lemtel-production-drill-v1\n${canonical(payload)}`))).toString('hex');
    const sealed = await sealDrillReceipt({ session, receipt: { payload, signature }, issuedAt: issued, expiresAt: payload.expires_at });
    const settings = await cf('/settings', {}, 'settings_read_failed');
    const namespace = settings.bindings.find((binding) => binding.name === 'STATE')?.namespace_id;
    gate(/^[a-f0-9]{32}$/u.test(namespace || ''), 'state_namespace_unresolved');
    let response;
    try { response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${g.accountId}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent('lemtel_failover_execution_v1:production-drill')}`,
      { method: 'PUT', headers: { authorization: `Bearer ${g.cfToken}`, 'content-type': 'text/plain' }, body: JSON.stringify(sealed), redirect: 'error' }); }
    catch { response = null; }
    gate(response?.ok && (await response.json().catch(() => null))?.success === true, 'drill_authorization_write_failed');
    log(`supervised_drill_authorization=written_valid_${g.drillHours}h`);
  }
  return { state: 'complete', revision: g.revision, failover_mode: 'disabled', promotion_mode: 'review' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBootstrap({ log: (line) => console.info(line) }).then((result) => {
    console.info(`config_revision=${result.revision}`);
    console.info('automatic_failover_active=false');
    console.info('arbiter_bootstrap_status=complete');
  }).catch((error) => {
    console.error(`arbiter_bootstrap_status=blocked\nreason=${error instanceof BootstrapGateError ? error.code : 'unexpected_error'}`);
    process.exitCode = 1;
  });
}
