import assert from 'node:assert/strict';
import test from 'node:test';
import { LemtelFailoverSerializer } from '../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
import { createSerializerBinding } from './lemtel-serializer-test-helpers.mjs';

const singleton = 'lemtel-failover-arbiter-serializer-v1';
const origin = ['https:', '', 'serializer.invalid'].join('/');
const revision = 'synthetic-config-v1';
const key = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const incident = '11111111-1111-4111-8111-111111111111';

async function call(stub, path, body) {
  const response = await stub.fetch(new Request(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test('singleton Durable Object transaction permits one concurrent lease and redacts refusals', async (t) => {
  let now = Math.floor(Date.UTC(2034, 0, 1) / 1000);
  t.mock.method(Date, 'now', () => now * 1000);
  const { binding, names, storage } = createSerializerBinding();
  const stub = binding.get(binding.idFromName(singleton));
  const [one, two] = await Promise.all([
    call(stub, '/lease', { execution_key: key(1), config_revision: revision }),
    call(stub, '/lease', { execution_key: key(2), config_revision: revision }),
  ]);
  const granted = [one, two].filter((result) => result.status === 200);
  const refused = [one, two].filter((result) => result.status === 409);
  assert.equal(granted.length, 1);
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0].body, { format: 'lemtel_failover_serializer_v1', outcome: 'refused' });
  assert.deepEqual(names, [singleton]);
  assert.equal([...storage.values.keys()].filter((entry) => entry === 'lease').length, 1);
});

test('lease capability is revision-bound, short-lived, and records each destructive incident intent once', async (t) => {
  let now = Math.floor(Date.UTC(2034, 0, 1) / 1000);
  t.mock.method(Date, 'now', () => now * 1000);
  const { binding, storage } = createSerializerBinding();
  const stub = binding.get(binding.idFromName(singleton));
  const acquired = await call(stub, '/lease', { execution_key: key(3), config_revision: revision });
  assert.equal(acquired.status, 200);
  const lease = acquired.body.lease;
  const correct = { execution_key: lease.execution_key, config_revision: revision, capability: lease.capability,
    incident_id: incident, intent: 'shutdown' };
  assert.equal((await call(stub, '/intent', { ...correct, config_revision: 'synthetic-wrong-v1' })).status, 409);
  assert.equal((await call(stub, '/intent', correct)).status, 200);
  assert.equal((await call(stub, '/intent', correct)).status, 409, 'same incident/action is one-use');
  const ledger = [...storage.values.entries()].filter(([entry]) => entry.startsWith('intent:'));
  assert.equal(ledger.length, 1);
  assert.doesNotMatch(ledger[0][0], /11111111/u, 'ledger key contains no clear incident identifier');
  now += 16;
  assert.equal((await call(stub, '/intent', { ...correct, intent: 'power_off' })).status, 409, 'expired capability is refused');
  assert.equal((await call(stub, '/lease', { execution_key: key(4), config_revision: revision })).status, 200);
});

test('missing or invalid Durable Object binding blocks active work before any health/provider fetch', async () => {
  // The behavioral Worker fixture covers a valid sealed config; this source-level guard keeps the binding fail-closed.
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(
    new URL('../infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs', import.meta.url), 'utf8'));
  assert.match(source, /if \(!stub\) return null/u);
  assert.match(source, /serializer_lease_unavailable/u);
  assert.match(source, /const lease = await acquireLease\(env\);[\s\S]*?const denied = await readiness/u);
  assert.match(source, /if \(env\.FAILOVER_MODE !== 'active'\) return json\(status\('disabled_or_dry_run'\)\)/u);
  // The agent mailbox takes the singleton lease before reading the incident and records the dispatch
  // intent and the dispatched state before a command can leave the Worker.
  assert.match(source, /async function agentCommand[\s\S]*?const lease = await acquireLease\(env\);[\s\S]*?STATE\.get\(INCIDENT_KEY\)/u);
  assert.match(source, /recordSerializedIntent\(env, lease, incident\.incident_id, 'dispatch'\)[\s\S]*?await persist\(env, incident\);[\s\S]*?state: 'command_available'/u);
  assert.equal(typeof LemtelFailoverSerializer, 'function');
});
