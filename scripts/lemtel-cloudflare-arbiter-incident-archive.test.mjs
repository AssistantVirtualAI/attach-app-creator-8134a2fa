import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveIncident, INCIDENT_KEY, ARCHIVE_PREFIX } from './lemtel-cloudflare-arbiter-incident-archive.mjs';

// Offline: simulated Cloudflare (settings + KV) and DigitalOcean APIs. All identifiers are synthetic.
const account = 'a'.repeat(32), ns = 'b'.repeat(32), droplet = '777777777';
const record = JSON.stringify({ format: 'lemtel_failover_sealed_state_v1', version: 1, algorithm: 'AES-256-GCM', kind: 'incident',
  config_revision: 'lemtel-failover-drill-202610190844', issued_at: 1, expires_at: 2, iv: 'x', ciphertext: 'y' });

function world({ mode = 'disabled', power = 'active', incident = record, extraBinding = false } = {}) {
  const kv = new Map(incident === null ? [] : [[INCIDENT_KEY, incident], ['lemtel_failover_execution_v1:status', '{"state":"blocked"}']]);
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (url.endsWith('/workers/scripts/lemtel-failover-arbiter/settings')) {
      const bindings = [{ name: 'STATE', type: 'kv_namespace', namespace_id: ns },
        { name: 'ARBITER_SERIALIZER', type: 'durable_object_namespace', class_name: 'LemtelFailoverSerializer' },
        { name: 'CONFIG_REVISION', type: 'plain_text', text: 'r' }, { name: 'CONFIG_STATE_ENCRYPTION_KEY', type: 'secret_text' },
        { name: 'FAILOVER_MODE', type: 'plain_text', text: mode }, ...(extraBinding ? [{ name: 'X', type: 'plain_text' }] : [])];
      return json({ success: true, result: { bindings } });
    }
    if (url === `https://api.digitalocean.com/v2/droplets/${droplet}`) return json({ droplet: { id: Number(droplet), status: power } });
    const prefix = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns}/values/`;
    assert.ok(url.startsWith(prefix), url);
    const key = decodeURIComponent(url.slice(prefix.length));
    if ((init.method || 'GET') === 'GET') return kv.has(key) ? new Response(kv.get(key)) : new Response('', { status: 404 });
    if (init.method === 'PUT') { kv.set(key, init.body); return json({ success: true }); }
    if (init.method === 'DELETE') { kv.delete(key); return json({ success: true }); }
    throw new Error('unexpected');
  };
  const env = { LEMTEL_ARBITER_INCIDENT_ARCHIVE_INTENT: 'ARCHIVE_INCIDENT_AFTER_MANUAL_RECONCILIATION_V1',
    LEMTEL_CF_TARGET_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: 'c'.repeat(40), LEMTEL_DO_ARBITER_TOKEN: 'd'.repeat(40),
    LEMTEL_DO_WRITER_DROPLET_ID: droplet, LEMTEL_HOSTINGER_IN_RECOVERY: 't' };
  return { kv, calls, fetchImpl, env };
}

test('archives the sealed incident unchanged under a timestamped key, then removes the live key', async () => {
  const w = world();
  const lines = [];
  const result = await archiveIncident({ env: w.env, fetchImpl: w.fetchImpl, now: () => new Date('2026-10-19T09:30:00.123Z'), log: (l) => lines.push(l) });
  assert.equal(result.archiveKey, `${ARCHIVE_PREFIX}20261019T093000Z`);
  assert.equal(w.kv.get(result.archiveKey), record);
  assert.equal(w.kv.has(INCIDENT_KEY), false);
  assert.equal(w.kv.has('lemtel_failover_execution_v1:status'), false, 'stale status removed');
  assert.ok(lines.includes('incident_archived=true'));
  assert.ok(w.calls.findIndex((c) => c.startsWith('PUT')) < w.calls.findIndex((c) => c.startsWith('DELETE')), 'copy before delete');
});

test('absent incident: nothing to do, nothing written', async () => {
  const w = world({ incident: null });
  assert.deepEqual(await archiveIncident({ env: w.env, fetchImpl: w.fetchImpl }), { archived: false });
  assert.equal(w.calls.some((c) => /^(PUT|DELETE)/u.test(c)), false);
});

test('refuses (nothing changed) without intent, with an active arbiter, a writer still off, a promoted Hostinger or odd bindings', async () => {
  const cases = [
    [{}, { LEMTEL_ARBITER_INCIDENT_ARCHIVE_INTENT: 'yes' }, 'intent_required'],
    [{ mode: 'active' }, {}, 'arbiter_not_disabled'],
    [{ power: 'off' }, {}, 'writer_droplet_not_active'],
    [{}, { LEMTEL_HOSTINGER_IN_RECOVERY: 'f' }, 'hostinger_not_confirmed_in_recovery'],
    [{ extraBinding: true }, {}, 'remote_bindings_unexpected'],
    [{ incident: 'not json' }, {}, 'incident_record_unexpected'],
  ];
  for (const [options, overrides, code] of cases) {
    const w = world(options);
    await assert.rejects(archiveIncident({ env: { ...w.env, ...overrides }, fetchImpl: w.fetchImpl }), (error) => error.code === code, code);
    assert.equal(w.calls.some((c) => /^(PUT|DELETE)/u.test(c)), false, `${code}: nothing written`);
  }
});
