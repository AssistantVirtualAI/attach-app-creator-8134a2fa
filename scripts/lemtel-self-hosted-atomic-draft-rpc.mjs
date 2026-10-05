// Phase 34D — validates a local SQL RPC package only. It never applies SQL or contacts a target.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PACKAGE_DIR = 'infra/lemtel-self-hosted/rpc/lemtel-mobile-config-draft-write';
export const MIGRATION = '0001_lemtel_mobile_config_draft_write.sql';
const MANIFEST = 'manifest.json';
const MANIFEST_KEYS = [
  'package_version', 'scope', 'apply_authorized', 'data_import_authorized', 'function_deployment_authorized',
  'client_cutover_authorized', 'required_schema_package', 'required_preconditions', 'migration',
];
const SIGNATURE = 'text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text';
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateAtomicDraftRpc(manifest, sql) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.package_version !== 'lemtel_mobile_config_draft_rpc_v1' ||
      manifest.scope !== 'offline_atomic_rpc_package' || manifest.apply_authorized !== false ||
      manifest.data_import_authorized !== false || manifest.function_deployment_authorized !== false ||
      manifest.client_cutover_authorized !== false || manifest.required_schema_package !== 'lemtel_mobile_config_schema_v1' ||
      manifest.migration !== MIGRATION || !Array.isArray(manifest.required_preconditions) ||
      manifest.required_preconditions.length < 5 || typeof sql !== 'string') return false;
  const required = [
    /CREATE OR REPLACE FUNCTION public\.lemtel_mobile_config_draft_write\(/u,
    /LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = pg_catalog, public/u,
    /p_operation NOT IN \('create_draft', 'update_draft'\)/u,
    /FROM public\.lemtel_organization_memberships AS membership/u,
    /membership\.status = 'active'/u,
    /v_role NOT IN \('owner', 'admin'\)/u,
    /INSERT INTO public\.lemtel_mobile_config_revisions/u,
    /UPDATE public\.lemtel_mobile_config_revisions AS config/u,
    /config\.status = 'draft'/u,
    /INSERT INTO public\.lemtel_mobile_admin_audit/u,
    /jsonb_build_object\('operation', p_operation, 'channel', v_config\.channel, 'revision', v_config\.revision\)/u,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.lemtel_mobile_config_draft_write\\(${SIGNATURE.replaceAll('(', '\\(').replaceAll(')', '\\)')}\\) FROM PUBLIC`, 'u'),
    new RegExp(`REVOKE ALL ON FUNCTION public\\.lemtel_mobile_config_draft_write\\(${SIGNATURE.replaceAll('(', '\\(').replaceAll(')', '\\)')}\\) FROM anon, authenticated`, 'u'),
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.lemtel_mobile_config_draft_write\\(${SIGNATURE.replaceAll('(', '\\(').replaceAll(')', '\\)')}\\) TO service_role`, 'u'),
    /\nBEGIN;\n/u,
    /\nCOMMIT;\s*$/u,
  ];
  if (!required.every((pattern) => pattern.test(sql))) return false;
  if (/\b(?:planipret|pp_|fusionpbx|storage\.buckets|CREATE EXTENSION|DROP\s+TABLE|ALTER\s+ROLE)\b/iu.test(sql)) return false;
  const inserts = sql.match(/INSERT INTO public\.lemtel_[a-z_]+/gu) ?? [];
  const updates = sql.match(/UPDATE public\.lemtel_[a-z_]+/gu) ?? [];
  return inserts.length === 2 && inserts.includes('INSERT INTO public.lemtel_mobile_config_revisions') &&
    inserts.includes('INSERT INTO public.lemtel_mobile_admin_audit') && updates.length === 1 &&
    updates[0] === 'UPDATE public.lemtel_mobile_config_revisions';
}

export function reviewAtomicDraftRpc(manifest, sql) {
  if (!validateAtomicDraftRpc(manifest, sql)) {
    return { status: 'atomic_draft_rpc_invalid', authorization: false, reasons: ['ATOMIC_DRAFT_RPC_INVALID', 'POLICY_REVIEW_REQUIRED'] };
  }
  return {
    status: 'atomic_draft_rpc_offline_ready',
    authorization: false,
    target_schema_write_authorized: false,
    function_deployment_authorized: false,
    data_import_authorized: false,
    client_cutover_authorized: false,
    reasons: ['EXPLICIT_TARGET_SCHEMA_WRITE_APPROVAL_REQUIRED', 'SYNTHETIC_RBAC_AND_ROLLBACK_TEST_REQUIRED', 'EDGE_DEPLOYMENT_NOT_AUTHORIZED'],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const base = join(root, PACKAGE_DIR);
    const manifest = JSON.parse(reader(join(base, MANIFEST), 'utf8'));
    const sql = reader(join(base, MIGRATION), 'utf8');
    return { code: 78, stdout: `${JSON.stringify(reviewAtomicDraftRpc(manifest, sql))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"atomic_draft_rpc_invalid","authorization":false,"reasons":["ATOMIC_DRAFT_RPC_UNREADABLE","POLICY_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
