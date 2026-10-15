import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('telephony preparation manifest pins a non-operational Lemtel-only source set', () => {
  const manifest = JSON.parse(read('infra/lemtel-self-hosted/migrations/lemtel-telephony-preparation-manifest.json'));
  assert.equal(manifest.deployment_authorized, false);
  assert.equal(manifest.activation_authorized, false);
  assert.equal(manifest.schema_apply_authorized, false);
  for (const source of [...manifest.migration_sources, ...manifest.edge_sources]) {
    assert.match(source.path, /^infra\/lemtel-/);
    assert.equal(source.sha256, createHash('sha256').update(read(source.path)).digest('hex'), `stale digest: ${source.path}`);
  }
  const forbidden = manifest.explicitly_excluded.join(' ');
  for (const value of ['planipret_import', 'avastatistic_import', 'fusionpbx', 'provider_connection', 'automatic_failover']) assert.match(forbidden, new RegExp(value));
});

test('preparation schema is tenant-scoped, server-only and stores no operational telephony material', () => {
  const source = read('infra/lemtel-self-hosted/migrations/0018_lemtel_telephony_preparation_governance.sql');
  assert.match(source, /organization_id uuid NOT NULL REFERENCES public\.lemtel_organizations/);
  assert.match(source, /PRIMARY KEY \(organization_id, capability_key\)/);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /REVOKE ALL ON TABLE public\.lemtel_telephony_preparation_states FROM PUBLIC, anon, authenticated/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.lemtel_set_telephony_preparation_state/);
  assert.match(source, /telephony_preparation_review_ready/);
  assert.match(source, /telephony_preparation_reset/);
  assert.doesNotMatch(source, /(?:https?:\/\/|password\s*=|token\s*=|secret\s*=|provider[_-]host)/i);
});
