import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-manifest/index.ts');
const manifestPath = resolve(root, 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-manifest/manifest.json');
const source = () => readFileSync(sourcePath, 'utf8');

test('published manifest package remains source-only and cutover-denied', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.package_version, 'lemtel_mobile_config_manifest_v1');
  assert.equal(manifest.scope, 'offline_function_source_only');
  assert.equal(manifest.deployment_authorized, false);
  assert.equal(manifest.client_cutover_authorized, false);
  assert.equal(manifest.data_import_authorized, false);
  assert.deepEqual(manifest.capabilities, ['published_config_manifest_read']);
  for (const excluded of ['draft_read', 'admin_write', 'storage', 'release', 'pbx', 'turn', 'push', 'external_calls']) assert(manifest.explicitly_excluded.includes(excluded), excluded);
  for (const prerequisite of ['approved_atomic_publish_rpc', 'synthetic_rbac_and_manifest_validation', 'approved_edge_deployment', 'approved_client_cutover']) assert(manifest.deployment_prerequisites.includes(prerequisite), prerequisite);
});

test('request contract is exact, authenticated, organization-scoped, and read-only', () => {
  const text = source();
  assert(text.includes('Object.keys(raw).length !== 2'));
  assert(text.includes('!("organizationId" in raw) || !("channel" in raw)'));
  assert(text.includes('admin.auth.getUser(token)'));
  assert(text.includes('.from("lemtel_organization_memberships")'));
  assert(text.includes('.eq("organization_id", request.organizationId)'));
  assert(text.includes('.eq("user_id", userId)'));
  assert(text.includes('.eq("status", "active")'));
  assert(text.includes('if (membershipError || !membership) return respond({ error: "forbidden" }, 403);'));
  assert(!text.includes('.insert(') && !text.includes('.update(') && !text.includes('.upsert(') && !text.includes('.delete(') && !text.includes('.rpc('));
});

test('only a published configuration is read and the manifest excludes identifiers and operational metadata', () => {
  const text = source();
  assert(text.includes('const SELECT_COLUMNS = "channel,revision,flags,messages,settings,min_version,recommended_version,maintenance_mode,maintenance_message";'));
  assert(text.includes('.eq("status", "published")'));
  const manifest = text.slice(text.indexOf('export function toManifest'), text.indexOf('export async function handler'));
  for (const forbidden of ['organizationId', 'organization_id', 'userId', 'published_at', 'published_by', 'created_at']) assert(!manifest.includes(forbidden), forbidden);
  for (const required of ['schemaVersion', 'channel', 'revision', 'flags', 'messages', 'settings', 'minVersion', 'recommendedVersion', 'maintenanceMode', 'maintenanceMessage']) assert(manifest.includes(required), required);
});

test('manifest validates returned JSON and contains no shared-product, PBX, Storage, or external capability', () => {
  const text = source().toLowerCase();
  assert(text.includes('safeconfigobject(row.flags)'));
  assert(text.includes('sensitive_key_re.test(key)'));
  for (const forbidden of ['mobile_app_config', 'planipret', 'fusionpbx', 'storage.', 'functions.invoke', 'fetch(', 'console.']) assert(!text.includes(forbidden), forbidden);
  assert(text.includes('"cache-control": "no-store"'));
});
