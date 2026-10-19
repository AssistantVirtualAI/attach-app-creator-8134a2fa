// Operator tool: closes a failover incident after a drill or a real failover has been reconciled by hand.
// Without it, the next sealed bootstrap sees an earlier-revision incident that reached a destructive step and
// (by design) blocks with previous_revision_incident_manual_review forever.
//
// Gates (all mandatory, nothing is changed when one fails):
//   - explicit intent LEMTEL_ARBITER_INCIDENT_ARCHIVE_INTENT=ARCHIVE_INCIDENT_AFTER_MANUAL_RECONCILIATION_V1;
//   - the arbiter Worker is in `disabled` mode (read from its settings, bindings exactly as expected);
//   - the DigitalOcean writer droplet is `active` again (read with the restricted arbiter DO token);
//   - the operator confirms the Hostinger standby is still in recovery (LEMTEL_HOSTINGER_IN_RECOVERY=t, which the
//     launcher reads over SSH right before): a promoted Hostinger means a real failover, not something to archive.
// The incident record is copied, unchanged and still sealed, to an archive key, then the live key is deleted.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_NAME = 'lemtel-failover-arbiter';
export const INCIDENT_KEY = 'lemtel_failover_execution_v1:incident';
export const ARCHIVE_PREFIX = 'lemtel_failover_execution_v1:archived-incident:';
const EXPECTED_BINDINGS = ['ARBITER_SERIALIZER', 'CONFIG_REVISION', 'CONFIG_STATE_ENCRYPTION_KEY', 'FAILOVER_MODE', 'STATE'];
export class ArchiveGateError extends Error { constructor(code) { super(code); this.code = code; } }
const gate = (ok, code) => { if (!ok) throw new ArchiveGateError(code); };

export async function archiveIncident({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(),
  log = () => {} } = {}) {
  gate(env.LEMTEL_ARBITER_INCIDENT_ARCHIVE_INTENT === 'ARCHIVE_INCIDENT_AFTER_MANUAL_RECONCILIATION_V1', 'intent_required');
  gate(/^[a-f0-9]{32}$/u.test(env.LEMTEL_CF_TARGET_ACCOUNT_ID || ''), 'account_id_invalid');
  gate(typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.length >= 20, 'cloudflare_token_required');
  gate(typeof env.LEMTEL_DO_ARBITER_TOKEN === 'string' && env.LEMTEL_DO_ARBITER_TOKEN.length >= 20, 'do_token_required');
  gate(/^[1-9]\d{0,19}$/u.test(env.LEMTEL_DO_WRITER_DROPLET_ID || ''), 'droplet_id_invalid');
  gate(env.LEMTEL_HOSTINGER_IN_RECOVERY === 't', 'hostinger_not_confirmed_in_recovery');
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.LEMTEL_CF_TARGET_ACCOUNT_ID}`;
  const auth = { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  const call = async (url, init, code) => {
    try { return await fetchImpl(url, { ...init, redirect: 'manual' }); } catch { throw new ArchiveGateError(code); }
  };
  const settingsResponse = await call(`${base}/workers/scripts/${WORKER_NAME}/settings`, { headers: auth }, 'settings_read_failed');
  const settings = await settingsResponse.json().catch(() => null);
  gate(settingsResponse.ok && settings?.success === true, 'settings_read_failed');
  const byName = new Map((settings.result.bindings || []).map((b) => [b.name, b]));
  gate([...byName.keys()].sort().join(',') === EXPECTED_BINDINGS.join(','), 'remote_bindings_unexpected');
  gate(byName.get('FAILOVER_MODE').type === 'plain_text' && byName.get('FAILOVER_MODE').text === 'disabled', 'arbiter_not_disabled');
  const ns = byName.get('STATE').namespace_id;
  gate(/^[a-f0-9]{32}$/u.test(ns || ''), 'state_namespace_unresolved');

  const dropletResponse = await call(`https://api.digitalocean.com/v2/droplets/${env.LEMTEL_DO_WRITER_DROPLET_ID}`,
    { headers: { authorization: `Bearer ${env.LEMTEL_DO_ARBITER_TOKEN}` } }, 'droplet_read_failed');
  const droplet = await dropletResponse.json().catch(() => null);
  gate(dropletResponse.status === 200 && String(droplet?.droplet?.id) === env.LEMTEL_DO_WRITER_DROPLET_ID, 'droplet_read_failed');
  gate(droplet.droplet.status === 'active', 'writer_droplet_not_active');

  const value = (key) => `${base}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;
  const current = await call(value(INCIDENT_KEY), { headers: auth }, 'incident_read_failed');
  if (current.status === 404) { log('incident_record=absent'); log('incident_archived=false'); return { archived: false }; }
  gate(current.status === 200, 'incident_read_failed');
  const raw = await current.text();
  let metadata; try { metadata = JSON.parse(raw); } catch { metadata = null; }
  gate(metadata && metadata.kind === 'incident' && typeof metadata.config_revision === 'string', 'incident_record_unexpected');
  const stamp = now().toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z');
  const archiveKey = `${ARCHIVE_PREFIX}${stamp}`;
  const put = await call(value(archiveKey), { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body: raw }, 'archive_write_failed');
  gate(put.ok, 'archive_write_failed');
  const check = await call(value(archiveKey), { headers: auth }, 'archive_verify_failed');
  gate(check.status === 200 && await check.text() === raw, 'archive_verify_failed');
  const del = await call(value(INCIDENT_KEY), { method: 'DELETE', headers: auth }, 'incident_delete_failed');
  gate(del.ok, 'incident_delete_failed');
  // The last stored status belongs to the archived incident: drop it so /status no longer shows a stale state.
  const status = await call(value('lemtel_failover_execution_v1:status'), { method: 'DELETE', headers: auth }, 'status_reset_failed');
  gate(status.ok || status.status === 404, 'status_reset_failed');
  log(`incident_revision=${metadata.config_revision}`);
  log(`incident_archived_as=${archiveKey}`);
  log('incident_archived=true');
  return { archived: true, archiveKey };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  archiveIncident({ log: (line) => console.info(line) }).then(() => console.info('incident_archive_status=complete'))
    .catch((error) => { console.info(`incident_archive_status=failed\nreason=${error instanceof ArchiveGateError ? error.code : 'unexpected_error'}`); process.exitCode = 1; });
}
