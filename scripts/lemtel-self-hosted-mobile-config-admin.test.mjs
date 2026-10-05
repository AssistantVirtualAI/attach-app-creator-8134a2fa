import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-admin/index.ts');
const manifestPath = resolve(root, 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-admin/manifest.json');
const source = () => readFileSync(sourcePath, 'utf8');

test('mobile config admin package remains source-only and deployment-denied', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.scope, 'offline_function_source_only');
  assert.equal(manifest.deployment_authorized, false);
  assert.equal(manifest.client_cutover_authorized, false);
  assert.equal(manifest.data_import_authorized, false);
  assert.deepEqual(manifest.capabilities, ['admin_draft_create', 'admin_draft_update', 'admin_draft_list']);
  for (const forbidden of ['publish', 'retire', 'storage_upload', 'artifact_registration', 'public_client_manifest', 'pbx', 'push', 'external_calls']) {
    assert(manifest.explicitly_excluded.includes(forbidden), forbidden);
  }
  assert(manifest.deployment_prerequisites.includes('approved_atomic_draft_rpc'));
});

test('function admits only explicit draft actions and exact request bodies', () => {
  const text = source();
  assert(text.includes('const ACTIONS = ["create_draft", "update_draft", "list_drafts"] as const;'));
  assert(text.includes('Object.keys(raw).some((key) => !expected.includes(key))'));
  assert(text.includes('expected.some((key) => !(key in raw))'));
  assert(text.includes('if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1)'));
  assert(text.includes('if (typeof raw.configId !== "string" || !UUID_RE.test(raw.configId))'));
  assert(!text.includes('"publish"') && !text.includes('"retire"'));
  assert(!text.includes('.upsert(') && !text.includes('.delete('));
});

test('authorization is server-side, organization-scoped, and admin-only', () => {
  const text = source();
  assert(text.includes('admin.auth.getUser(token)'));
  assert(text.includes('.from("lemtel_organization_memberships")'));
  assert(text.includes('.eq("organization_id", request.organizationId)'));
  assert(text.includes('.eq("user_id", userId)'));
  assert(text.includes('.eq("status", "active")'));
  assert(text.includes('!["owner", "admin"].includes(membership.role)'));
  assert(text.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert(!text.includes('is_planipret_admin') && !text.includes('is_super_admin'));
});

test('draft contents are bounded and sensitive configuration keys are rejected', () => {
  const text = source();
  assert(text.includes('const MAX_JSON_BYTES = 16 * 1024;'));
  assert(text.includes('const MAX_JSON_DEPTH = 5;'));
  assert(text.includes('const MAX_JSON_KEYS = 50;'));
  assert(text.includes('SENSITIVE_KEY_RE.test(key)'));
  assert(text.includes('new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_JSON_BYTES'));
  assert(text.includes('validDraftFields(raw)'));
});

test('no shared-product table, telephony, Storage, deployment, or raw audit payload enters the source package', () => {
  const text = source().toLowerCase();
  for (const forbidden of ['mobile_app_config', 'mobile_app_releases', 'mobile_app_config_audit', 'planipret', 'fusionpbx', 'storage.', 'functions.invoke', 'fetch(', 'console.']) {
    assert(!text.includes(forbidden), forbidden);
  }
  assert(text.includes('sensitive_key_re.test(key)'));
  assert(!text.includes('.from("lemtel_mobile_admin_audit").insert'));
});

test('writes are delegated to a future atomic draft-and-audit RPC and never mutate rows directly', () => {
  const text = source();
  assert(text.includes('admin.rpc("lemtel_mobile_config_draft_write", rpcArguments)'));
  assert(text.includes('p_operation: request.action'));
  assert(text.includes('p_actor_id: userId'));
  assert(text.includes('p_organization_id: request.organizationId'));
  assert(text.includes('write the draft and its minimal audit record together or write neither'));
  assert(!text.includes('.from("lemtel_mobile_config_revisions").insert'));
  assert(!text.includes('.from("lemtel_mobile_config_revisions").update'));
  assert(text.includes('.limit(50)'));
  assert(text.includes('"Cache-Control": "no-store"'));
});
