import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const contractPath = 'infra/lemtel-self-hosted/private-directory-and-wss-source-contract.json';
const migrationPath = 'infra/lemtel-self-hosted/migrations/0002_lemtel_private_directory_and_wss_diagnostics.sql';
const contactsPath = 'infra/lemtel-self-hosted/functions/lemtel-contacts/index.ts';
const lookupPath = 'infra/lemtel-self-hosted/functions/lemtel-caller-lookup/index.ts';
const wssPath = 'infra/lemtel-self-hosted/functions/lemtel-wss-diagnostics/index.ts';

test('offline contract denies schema application, deployment, client cutover, secrets, runtime writes, Planipret import and PBX changes', () => {
  const contract = json(contractPath);
  assert.equal(contract.contract_version, 'lemtel_private_directory_and_wss_source_v1');
  assert.equal(contract.scope, 'offline_schema_and_function_source_only');
  assert.equal(contract.migration.path, migrationPath);
  for (const value of [
    contract.migration.apply_authorized,
    contract.migration.planipret_import_authorized,
    contract.migration.pbx_change_authorized,
    contract.deployment.edge_deployment_authorized,
    contract.deployment.client_cutover_authorized,
    contract.deployment.secrets_configured,
    contract.deployment.runtime_write_authorized,
    contract.privacy.raw_wss_urls_accepted,
    contract.privacy.sip_credentials_accepted,
    contract.privacy.request_body_logging,
  ]) assert.equal(value, false);
  assert.equal(contract.privacy.contact_visibility, 'owner_private_only');
  assert.deepEqual(contract.functions, ['lemtel-contacts', 'lemtel-caller-lookup', 'lemtel-wss-diagnostics']);
});

test('migration creates empty Lemtel-only private tables with direct access revoked and RLS enabled', () => {
  const sql = read(migrationPath);
  for (const table of ['lemtel_contacts', 'lemtel_wss_diagnostic_events']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated;`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /owner_user_id = auth\.uid\(\)/);
  assert.match(sql, /actor_user_id = auth\.uid\(\)/);
  assert.match(sql, /never raw WSS URLs, SIP credentials, or request bodies/);
  for (const forbidden of ['planipret', 'fusionpbx', 'maestro', 'microsoft', 'storage\\s*\\.']) assert.doesNotMatch(sql.toLowerCase(), new RegExp(forbidden));
});

test('contacts function enforces explicit device input, active organization membership and owner-private reads/deletion', () => {
  const source = read(contactsPath);
  assert.match(source, /const ACTIONS = \["upsert_device", "list", "delete_device"\] as const;/);
  assert.match(source, /const MAX_CONTACTS = 200;/);
  assert(source.includes('const E164_RE = /^\\+[1-9][0-9]{7,14}$/;'));
  assert.match(source, /admin\.auth\.getUser\(token\)/);
  assert.match(source, /\.from\("lemtel_organization_memberships"\)/);
  assert.match(source, /\.eq\("organization_id", organizationId\)/);
  assert.match(source, /\.eq\("user_id", userId\)/);
  assert.match(source, /\.eq\("owner_user_id", userId\)/);
  assert.match(source, /onConflict: "organization_id,owner_user_id,source,external_id,phone_e164"/);
  assert.match(source, /request\.action === "delete_device"/);
  assert.match(source, /\.delete\(\{ count: "exact" \}\)/);
  assert.match(source, /\.eq\("source", "device"\)/);
  assert.match(source, /return respond\(\{ deleted: count \?\? 0, source: "device" \}\)/);
  assert.match(source, /"Cache-Control": "no-store"/);
  for (const forbidden of ['planipret', 'pp-', 'fusionpbx', 'fetch(', 'console.', 'storage.', 'functions.invoke']) assert(!source.toLowerCase().includes(forbidden), forbidden);
});

test('caller lookup is authenticated, private to the caller and returns a number-only fallback on no match', () => {
  const source = read(lookupPath);
  assert(source.includes('const E164_RE = /^\\+[1-9][0-9]{7,14}$/;'));
  assert.match(source, /\.eq\("owner_user_id", userId\)/);
  assert.match(source, /\.eq\("phone_e164", request\.phone\)/);
  assert.match(source, /\.limit\(1\)/);
  assert.match(source, /return \{ found: false, source: null/);
  assert.match(source, /admin\.auth\.getUser\(token\)/);
  for (const forbidden of ['planipret', 'pp-', 'maestro', 'microsoft', 'fusionpbx', 'fetch(', 'console.', 'storage.']) assert(!source.toLowerCase().includes(forbidden), forbidden);
});

test('WSS telemetry accepts only bounded endpoint identifiers and outcome codes, never raw URLs or secrets', () => {
  const source = read(wssPath);
  assert(source.includes('const ENDPOINT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;'));
  assert.match(source, /const FAILURE_CODES = \["timeout", "rejected", "closed", "tls", "unknown"\]/);
  assert.match(source, /const validLatency = \(value: unknown\): value is number => typeof value === "number" && Number\.isSafeInteger\(value\) && value >= 0 && value <= 30000/);
  assert.match(source, /\.from\("lemtel_wss_diagnostic_events"\)\.insert/);
  assert.match(source, /primary_endpoint_id: request\.primaryEndpointId/);
  assert.match(source, /fallback_endpoint_id: request\.fallbackEndpointId/);
  assert.match(source, /admin\.auth\.getUser\(token\)/);
  for (const forbidden of ['planipret', 'pp-', 'fusionpbx', 'fetch(', 'console.', 'storage.', 'authorization:', 'password']) assert(!source.toLowerCase().includes(forbidden), forbidden);
});

test('each new source package remains deployment-denied and is absent from the sealed two-function deployment package', () => {
  const manifests = [
    ['lemtel-contacts', 'infra/lemtel-self-hosted/functions/lemtel-contacts/manifest.json'],
    ['lemtel-caller-lookup', 'infra/lemtel-self-hosted/functions/lemtel-caller-lookup/manifest.json'],
    ['lemtel-wss-diagnostics', 'infra/lemtel-self-hosted/functions/lemtel-wss-diagnostics/manifest.json'],
  ];
  for (const [slug, path] of manifests) {
    const manifest = json(path);
    assert.equal(manifest.scope, 'offline_function_source_only');
    assert.equal(manifest.deployment_authorized, false, slug);
    assert.equal(manifest.client_cutover_authorized, false, slug);
    assert.equal(manifest.data_import_authorized, false, slug);
  }
  const sealedPackage = json('infra/lemtel-self-hosted/edge-functions/deployment-manifest.json');
  const sealedSlugs = sealedPackage.functions.map((entry) => entry.slug);
  for (const [slug] of manifests) assert.equal(sealedSlugs.includes(slug), false, slug);
});
