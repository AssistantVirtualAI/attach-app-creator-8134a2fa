import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { audit } from './lemtel-dependency-closure.mjs';

const repo = resolve(import.meta.dirname, '..');
const make = (root, file, content) => {
  const dest = join(root, file);
  mkdirSync(resolve(dest, '..'), { recursive: true });
  writeFileSync(dest, content);
};

test('actual Lemtel clients and import graph remain discovery, never a deployment allowlist', () => {
  const report = audit(repo);
  assert.equal(report.status, 'incomplete_manual_review_required');
  assert.equal(report.source_analysis_only, true);
  assert.equal(report.database_export_authorized, false);
  assert.equal(report.migration_replay_authorized, false);
  assert.equal(report.functions_deploy_authorized, false);
  assert.equal(report.findings_are_not_allowlist, true);
  assert.ok(report.client_dependencies.some((item) => item.function === 'fusionpbx-proxy' && item.entrypoint_present));
  assert.ok(report.function_import_closures.some((item) => item.function === 'fusionpbx-proxy'));
  assert.ok(report.function_import_closures.every((item) => item.classification === 'manual_review' && item.dynamic_calls_and_sql_dependencies_review_required));
  assert.deepEqual(report.client_callsite_findings.map((item) => item.client),
    ['ava-softphone-mobile', 'ava-softphone-desktop']);
  assert.ok(report.client_callsite_findings.every((item) => item.heuristic_manual_review_required &&
    item.unattributed_invocation_count >= 0 && item.interpolated_api_path_count >= 0 &&
    item.review_source_paths.every((path) => path.startsWith(`apps/${item.client}/src/`))));
  assert.deepEqual(audit(repo), report);
});

test('indirect Planiprêt and missing entrypoints are visible, but source literals and secrets are not serialized', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-closure-'));
  try {
    make(root, 'supabase/migrations/01.sql', 'CREATE TABLE public.lemtel_calls (id uuid);\n');
    make(root, 'supabase/functions/mobile-test/index.ts', `import {
  useShared,
} from '../_shared/shared.ts';
const privateValue = 'DO_NOT_PRINT_THIS';
Deno.env.get('DO_NOT_PRINT_THIS');
export const run = () => { useShared(); supabase.from('lemtel_calls'); };
`);
    make(root, 'supabase/functions/_shared/shared.ts', `import './more.ts';
export const useShared = () => { supabase.from('planipret_calls'); supabase.rpc('planipret_role'); };
`);
    make(root, 'supabase/functions/_shared/more.ts', 'const key = "DO_NOT_PRINT_THIS";\n');
    make(root, 'apps/ava-softphone-mobile/src/main.ts', `supabase.functions.invoke('mobile-test');
supabase.functions.invoke('not-created');
supabase.functions.invoke('pp-contacts-upsert');
`);
    make(root, 'apps/ava-softphone-mobile/src/main.test.ts', `supabase.functions.invoke('not-production');\n`);
    const report = audit(root);
    const current = report.function_import_closures.find((item) => item.function === 'mobile-test');
    assert.equal(current.transitive_source_file_count, 3);
    assert.equal(current.unresolved_relative_import_count, 0);
    assert.equal(current.direct_foreign_marker_detected, false);
    assert.equal(current.indirect_foreign_marker_detected, true);
    assert.equal(current.transitive_table_reference_count, 2);
    assert.equal(current.transitive_rpc_reference_count, 1);
    assert.deepEqual(report.client_dependencies.map((item) => item.function), ['mobile-test', 'not-created', 'pp-contacts-upsert']);
    assert.equal(report.client_dependencies.find((item) => item.function === 'not-created').entrypoint_present, false);
    assert.equal(report.client_dependencies.find((item) => item.function === 'pp-contacts-upsert').cross_product_marker, true);
    assert.ok(!JSON.stringify(report).includes('DO_NOT_PRINT_THIS'));
    assert.ok(!JSON.stringify(report).includes('planipret_calls'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing relative import is a blocking review signal, not an inferred clean dependency graph', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-closure-'));
  try {
    make(root, 'supabase/migrations/01.sql', 'CREATE TABLE public.lemtel_calls (id uuid);\n');
    make(root, 'supabase/functions/lemtel-test/index.ts', "import '../_shared/missing.ts';\n");
    const row = audit(root).function_import_closures.find((item) => item.function === 'lemtel-test');
    assert.equal(row.unresolved_relative_import_count, 1);
    assert.equal(row.dynamic_calls_and_sql_dependencies_review_required, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('computed client calls and interpolated endpoint paths remain review findings, not function names', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-closure-'));
  try {
    make(root, 'supabase/migrations/01.sql', 'CREATE TABLE public.lemtel_calls (id uuid);\n');
    make(root, 'supabase/functions/lemtel-valid/index.ts', 'export const run = () => true;\n');
    make(root, 'apps/ava-softphone-mobile/src/main.ts', `const secret = 'DO_NOT_PRINT_THIS';
client.functions.invoke('lemtel-valid');
client.functions.invoke(computedName);
client.functions.invoke('lemtel-phantom' + suffix);
fetch(\`\${api}/functions/v1/\${secret}\`);
fetch(\`\${api}/functions/v1/lemtel-phantom\${secret}\`);
`);
    make(root, 'apps/ava-softphone-desktop/src/main.ts', 'client.functions.invoke(dynamic + suffix);\n');
    const report = audit(root);
    assert.deepEqual(report.client_dependencies.map((item) => item.function), ['lemtel-valid']);
    assert.deepEqual(report.client_callsite_findings, [
      { client: 'ava-softphone-mobile', invocation_callsite_count: 3,
        unattributed_invocation_count: 2, interpolated_api_path_count: 2,
        review_source_paths: ['apps/ava-softphone-mobile/src/main.ts'],
        heuristic_manual_review_required: true },
      { client: 'ava-softphone-desktop', invocation_callsite_count: 1,
        unattributed_invocation_count: 1, interpolated_api_path_count: 0,
        review_source_paths: ['apps/ava-softphone-desktop/src/main.ts'],
        heuristic_manual_review_required: true },
    ]);
    assert.ok(!JSON.stringify(report).includes('DO_NOT_PRINT_THIS'));
    assert.ok(!JSON.stringify(report).includes('computedName'));
    assert.ok(!JSON.stringify(report).includes(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('audit remains read-only and does not import networking or execution APIs', () => {
  const source = readFileSync(join(repo, 'scripts/lemtel-dependency-closure.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|\.listen\s*\(|writeFile|process\.env\./);
  assert.throws(() => audit('/missing'), /INVENTORY_INPUTS_MISSING/);
});
