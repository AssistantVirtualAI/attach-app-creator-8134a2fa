import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewAtomicConfigPublishRpc, run, validateAtomicConfigPublishRpc } from './lemtel-self-hosted-atomic-config-publish-rpc.mjs';

const repo = resolve(import.meta.dirname, '..');
const manifest = () => ({
  package_version: 'lemtel_mobile_config_publish_rpc_v1', scope: 'offline_atomic_rpc_package', apply_authorized: false,
  data_import_authorized: false, function_deployment_authorized: false, client_cutover_authorized: false,
  required_schema_package: 'lemtel_mobile_config_schema_v1', migration: '0001_lemtel_mobile_config_publish.sql',
  required_preconditions: ['new_lemtel_auth_accounts_only', 'lemtel_organization_and_membership_bootstrap', 'synthetic_rbac_concurrency_and_rollback_validation', 'explicit_target_schema_write_approval', 'approved_edge_deployment'],
});
const sql = () => `
BEGIN;
CREATE OR REPLACE FUNCTION public.lemtel_mobile_config_publish(p_operation text, p_actor_id uuid, p_organization_id uuid, p_channel text, p_config_id uuid) RETURNS TABLE (id uuid) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_role text; v_config public.lemtel_mobile_config_revisions%ROWTYPE;
BEGIN
  IF p_operation NOT IN ('publish', 'retire') THEN RAISE EXCEPTION 'invalid'; END IF;
  PERFORM 1 FROM public.lemtel_organizations AS organization WHERE organization.id = p_organization_id FOR UPDATE;
  SELECT membership.role INTO v_role FROM public.lemtel_organization_memberships AS membership WHERE membership.status = 'active';
  IF v_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_operation = 'publish' THEN
    SELECT * INTO v_config FROM public.lemtel_mobile_config_revisions AS config WHERE config.status = 'draft';
    UPDATE public.lemtel_mobile_config_revisions AS existing SET status = 'retired' WHERE existing.status = 'published';
    UPDATE public.lemtel_mobile_config_revisions AS config SET status = 'published' WHERE config.status = 'draft';
  ELSE
    UPDATE public.lemtel_mobile_config_revisions AS config SET status = 'retired' WHERE config.status = 'published';
  END IF;
  INSERT INTO public.lemtel_mobile_admin_audit DEFAULT VALUES;
  PERFORM CASE WHEN p_operation = 'publish' THEN 'config_published' ELSE 'config_retired' END;
  PERFORM jsonb_build_object('operation', p_operation, 'channel', v_config.channel, 'revision', v_config.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) TO service_role;
COMMIT;
`;

test('valid publication RPC package stays offline-ready and denies every authorization lift', () => {
  const report = reviewAtomicConfigPublishRpc(manifest(), sql());
  assert.equal(report.status, 'atomic_config_publish_rpc_offline_ready');
  assert.equal(report.authorization, false);
  for (const key of ['target_schema_write_authorized', 'function_deployment_authorized', 'data_import_authorized', 'client_cutover_authorized']) assert.equal(report[key], false, key);
});

test('missing lock, membership gate, old-published retirement, audit, or restrictive grants fails closed', () => {
  assert.equal(validateAtomicConfigPublishRpc({ ...manifest(), apply_authorized: true }, sql()), false);
  assert.equal(validateAtomicConfigPublishRpc(manifest(), sql().replace('FOR UPDATE;', '')), false);
  assert.equal(validateAtomicConfigPublishRpc(manifest(), sql().replace("v_role NOT IN ('owner', 'admin')", "v_role = 'owner'")), false);
  assert.equal(validateAtomicConfigPublishRpc(manifest(), sql().replace("existing.status = 'published'", "existing.status = 'draft'")), false);
  assert.equal(validateAtomicConfigPublishRpc(manifest(), sql().replace('INSERT INTO public.lemtel_mobile_admin_audit DEFAULT VALUES;\n', '')), false);
  assert.equal(validateAtomicConfigPublishRpc(manifest(), sql().replace('TO service_role;', 'TO authenticated;')), false);
});

test('actual package is offline only and the validator has no network, process, write, environment, or SQL application capability', () => {
  const result = run(repo);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'atomic_config_publish_rpc_offline_ready');
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-atomic-config-publish-rpc.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|psql\b/);
});
