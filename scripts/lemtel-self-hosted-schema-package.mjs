// Phase 34A — validates a local, un-applied schema package only.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PACKAGE_DIR = 'infra/lemtel-self-hosted/migrations';
export const MIGRATION = '0001_lemtel_identity_mobile_config_and_releases.sql';
const MANIFEST = 'manifest.json';
const MANIFEST_KEYS = [
  'package_version', 'scope', 'apply_authorized', 'data_import_authorized', 'client_cutover_authorized',
  'storage_bucket_creation_authorized', 'migrations', 'required_follow_up',
];
const REQUIRED_TABLES = [
  'lemtel_organizations', 'lemtel_organization_memberships', 'lemtel_mobile_config_revisions',
  'lemtel_mobile_release_artifacts', 'lemtel_mobile_admin_audit',
];
const FORBIDDEN_SQL = /\b(?:INSERT\s+INTO|UPDATE\s+\S+|DELETE\s+FROM|COPY\s+\S+|TRUNCATE\s+\S+|DROP\s+TABLE|ALTER\s+ROLE|CREATE\s+EXTENSION)\b|\b(?:planipret|pp_)|storage\.buckets|service_role/iu;
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateSchemaPackage(manifest, sql) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.package_version !== 'lemtel_mobile_config_schema_v1' ||
      manifest.scope !== 'offline_schema_package' || manifest.apply_authorized !== false ||
      manifest.data_import_authorized !== false || manifest.client_cutover_authorized !== false ||
      manifest.storage_bucket_creation_authorized !== false || !Array.isArray(manifest.migrations) ||
      manifest.migrations.length !== 1 || manifest.migrations[0] !== MIGRATION ||
      !Array.isArray(manifest.required_follow_up) || manifest.required_follow_up.length < 5 || typeof sql !== 'string') return false;
  if (FORBIDDEN_SQL.test(sql)) return false;
  return REQUIRED_TABLES.every((table) =>
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'u').test(sql) &&
    new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'u').test(sql),
  ) && /CREATE POLICY lemtel_mobile_config_select_published/u.test(sql) &&
    /CREATE POLICY lemtel_mobile_release_select_active/u.test(sql) &&
    /CREATE POLICY lemtel_mobile_admin_audit_select_admin/u.test(sql) &&
    /REVOKE ALL ON public\.lemtel_mobile_config_revisions FROM anon, authenticated/u.test(sql) &&
    /\nBEGIN;\n/u.test(sql) && /\nCOMMIT;\s*$/u.test(sql);
}

export function reviewSchemaPackage(manifest, sql) {
  if (!validateSchemaPackage(manifest, sql)) {
    return { status: 'schema_package_invalid', authorization: false, reasons: ['SCHEMA_PACKAGE_INVALID', 'POLICY_REVIEW_REQUIRED'] };
  }
  return {
    status: 'schema_package_offline_ready',
    authorization: false,
    target_schema_write_authorized: false,
    data_import_authorized: false,
    storage_bucket_creation_authorized: false,
    function_implementation_authorized: false,
    client_cutover_authorized: false,
    table_count: REQUIRED_TABLES.length,
    migration_count: manifest.migrations.length,
    reasons: ['EXPLICIT_TARGET_SCHEMA_WRITE_APPROVAL_REQUIRED', 'NO_SHARED_DATA_IMPORT', 'STORAGE_DESIGN_PENDING', 'CLIENT_CUTOVER_NOT_AUTHORIZED'],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const base = join(root, PACKAGE_DIR);
    const manifest = JSON.parse(reader(join(base, MANIFEST), 'utf8'));
    const sql = reader(join(base, MIGRATION), 'utf8');
    return { code: 78, stdout: `${JSON.stringify(reviewSchemaPackage(manifest, sql))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"schema_package_invalid","authorization":false,"reasons":["SCHEMA_PACKAGE_UNREADABLE","POLICY_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
