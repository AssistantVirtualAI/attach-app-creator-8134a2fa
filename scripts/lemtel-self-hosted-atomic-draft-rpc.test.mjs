import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewAtomicDraftRpc, run, validateAtomicDraftRpc } from './lemtel-self-hosted-atomic-draft-rpc.mjs';

const repo = resolve(import.meta.dirname, '..');
const manifest = () => ({
  package_version: 'lemtel_mobile_config_draft_rpc_v1', scope: 'offline_atomic_rpc_package',
  apply_authorized: false, data_import_authorized: false, function_deployment_authorized: false,
  client_cutover_authorized: false, required_schema_package: 'lemtel_mobile_config_schema_v1',
  required_preconditions: ['new_lemtel_auth_accounts_only', 'lemtel_organization_and_membership_bootstrap', 'synthetic_rbac_and_rollback_validation', 'explicit_target_schema_write_approval', 'approved_edge_deployment'],
  migration: '0001_lemtel_mobile_config_draft_write.sql',
});
const sql = () => `
BEGIN;
CREATE OR REPLACE FUNCTION public.lemtel_mobile_config_draft_write(
  p_operation text, p_actor_id uuid, p_organization_id uuid, p_channel text, p_config_id uuid, p_revision integer, p_flags jsonb, p_messages jsonb, p_settings jsonb, p_min_version text, p_recommended_version text, p_maintenance_mode boolean, p_maintenance_message text
) RETURNS TABLE (id uuid) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_role text; v_config public.lemtel_mobile_config_revisions%ROWTYPE;
BEGIN
  IF p_operation NOT IN ('create_draft', 'update_draft') THEN RAISE EXCEPTION 'invalid'; END IF;
  SELECT membership.role INTO v_role FROM public.lemtel_organization_memberships AS membership WHERE membership.status = 'active';
  IF v_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.lemtel_mobile_config_revisions DEFAULT VALUES;
  UPDATE public.lemtel_mobile_config_revisions AS config SET flags = p_flags WHERE config.status = 'draft';
  INSERT INTO public.lemtel_mobile_admin_audit DEFAULT VALUES;
  PERFORM jsonb_build_object('operation', p_operation, 'channel', v_config.channel, 'revision', v_config.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) TO service_role;
COMMIT;
`;

test('valid atomic RPC package stays offline-ready and refuses every authorization lift', () => {
  const report = reviewAtomicDraftRpc(manifest(), sql());
  assert.equal(report.status, 'atomic_draft_rpc_offline_ready');
  assert.equal(report.authorization, false);
  for (const key of ['target_schema_write_authorized', 'function_deployment_authorized', 'data_import_authorized', 'client_cutover_authorized']) assert.equal(report[key], false, key);
});

test('missing transaction, authorization boundary, audit insert, or restrictive grants fail closed', () => {
  assert.equal(validateAtomicDraftRpc({ ...manifest(), apply_authorized: true }, sql()), false);
  assert.equal(validateAtomicDraftRpc(manifest(), sql().replace('SECURITY DEFINER\n', '')), false);
  assert.equal(validateAtomicDraftRpc(manifest(), sql().replace("v_role NOT IN ('owner', 'admin')", "v_role = 'owner'")), false);
  assert.equal(validateAtomicDraftRpc(manifest(), sql().replace('INSERT INTO public.lemtel_mobile_admin_audit DEFAULT VALUES;\n', '')), false);
  assert.equal(validateAtomicDraftRpc(manifest(), sql().replace('TO service_role;', 'TO authenticated;')), false);
  assert.equal(validateAtomicDraftRpc(manifest(), sql().replace('COMMIT;\n', '')), false);
});

test('actual package remains non-applied and permits only the expected two inserts and one draft update', () => {
  const result = run(repo);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'atomic_draft_rpc_offline_ready');
  assert.equal(report.target_schema_write_authorized, false);
  assert.equal(report.function_deployment_authorized, false);
  assert.equal(report.data_import_authorized, false);
  assert.equal(report.client_cutover_authorized, false);
});

test('atomic RPC validator has no network, process, write, environment, or SQL application capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-atomic-draft-rpc.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|psql\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
