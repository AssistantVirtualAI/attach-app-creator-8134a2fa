import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewSchemaPackage, run, validateSchemaPackage } from './lemtel-self-hosted-schema-package.mjs';

const repo = resolve(import.meta.dirname, '..');
const manifest = () => ({
  package_version: 'lemtel_mobile_config_schema_v1', scope: 'offline_schema_package', apply_authorized: false,
  data_import_authorized: false, client_cutover_authorized: false, storage_bucket_creation_authorized: false,
  migrations: ['0001_lemtel_identity_mobile_config_and_releases.sql'],
  required_follow_up: ['explicit_target_schema_write_approval', 'new_lemtel_auth_accounts_only', 'storage_bucket_and_policy_design', 'server_function_contracts', 'synthetic_routing_and_rls_tests'],
});
const sql = () => `
BEGIN;
CREATE TABLE IF NOT EXISTS public.lemtel_organizations (id uuid);
CREATE TABLE IF NOT EXISTS public.lemtel_organization_memberships (id uuid);
CREATE TABLE IF NOT EXISTS public.lemtel_mobile_config_revisions (id uuid);
CREATE TABLE IF NOT EXISTS public.lemtel_mobile_release_artifacts (id uuid);
CREATE TABLE IF NOT EXISTS public.lemtel_mobile_admin_audit (id uuid);
ALTER TABLE public.lemtel_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_config_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_release_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lemtel_mobile_config_revisions FROM anon, authenticated;
CREATE POLICY lemtel_mobile_config_select_published ON public.lemtel_mobile_config_revisions FOR SELECT USING (true);
CREATE POLICY lemtel_mobile_release_select_active ON public.lemtel_mobile_release_artifacts FOR SELECT USING (true);
CREATE POLICY lemtel_mobile_admin_audit_select_admin ON public.lemtel_mobile_admin_audit FOR SELECT USING (true);
COMMIT;
`;

test('valid package is offline-ready but never authorizes a target schema write or client cutover', () => {
  const result = reviewSchemaPackage(manifest(), sql());
  assert.equal(result.status, 'schema_package_offline_ready');
  assert.equal(result.authorization, false);
  for (const key of ['target_schema_write_authorized', 'data_import_authorized', 'storage_bucket_creation_authorized', 'function_implementation_authorized', 'client_cutover_authorized']) {
    assert.equal(result[key], false, key);
  }
  assert.equal(result.table_count, 5);
});

test('permission lifts, shared markers, data statements and missing RLS fail closed', () => {
  const lifted = manifest(); lifted.apply_authorized = true;
  assert.equal(validateSchemaPackage(lifted, sql()), false);
  assert.equal(validateSchemaPackage(manifest(), `${sql()}\nINSERT INTO public.lemtel_organizations DEFAULT VALUES;`), false);
  assert.equal(validateSchemaPackage(manifest(), `${sql()}\n-- planipret`), false);
  assert.equal(validateSchemaPackage(manifest(), sql().replace('ALTER TABLE public.lemtel_mobile_admin_audit ENABLE ROW LEVEL SECURITY;\n', '')), false);
  assert.equal(validateSchemaPackage(manifest(), sql().replace('BEGIN;\n', '')), false);
  assert.deepEqual(reviewSchemaPackage(lifted, sql()), {
    status: 'schema_package_invalid', authorization: false, reasons: ['SCHEMA_PACKAGE_INVALID', 'POLICY_REVIEW_REQUIRED'],
  });
});

test('actual package remains un-applied and contains no data import capability', () => {
  const result = run(repo);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'schema_package_offline_ready');
  assert.equal(report.target_schema_write_authorized, false);
  assert.equal(report.data_import_authorized, false);
  assert.equal(report.client_cutover_authorized, false);
});

test('schema package validator has no network, process launch, write, environment or apply capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-schema-package.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b|psql\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
