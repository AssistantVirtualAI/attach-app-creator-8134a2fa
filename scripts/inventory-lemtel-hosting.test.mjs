import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inventory } from './inventory-lemtel-hosting.mjs';

const repo = resolve(import.meta.dirname, '..');

test('actual functions are discovery candidates with unknown indirect dependencies', () => {
  const data = inventory(repo);
  assert.equal(data.status, 'discovery_only_manual_review_required');
  assert.equal(data.database_export_authorized, false);
  assert.equal(data.migration_replay_authorized, false);
  assert.equal(data.functions_deploy_authorized, false);
  for (const name of ['lemtel-client-config', 'get-turn-credentials', 'pbx-write']) {
    assert.ok(data.candidates.some((item) => item.function === name), name);
  }
  assert.ok(data.candidates.every((item) => item.classification === 'manual_review' && item.indirect_dependencies_review_required));
  assert.ok(data.ddl_candidates.every((item) => item.ddl_dependencies_review_required));
  assert.ok(data.candidates.every((item) => !/^(?:pp-|planipret-)/.test(item.function)));
  // These entries hard-code the bare word "planipret", not a planipret_ identifier.
  assert.equal(data.candidates.find((item) => item.function === 'mobile-config')?.direct_foreign_marker_detected, true);
  assert.equal(data.candidates.find((item) => item.function === 'mobile-config-admin')?.direct_foreign_marker_detected, true);
  assert.deepEqual(inventory(repo), data);
});

test('count source references without serializing secrets, source literals or SQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-inventory-'));
  try {
    const func = join(root, 'supabase/functions/mobile-test');
    const migrations = join(root, 'supabase/migrations');
    mkdirSync(func, { recursive: true }); mkdirSync(migrations, { recursive: true });
    writeFileSync(join(func, 'index.ts'), `import x from '../_shared/DO_NOT_PRINT_THIS.ts';\nconst secret = 'DO_NOT_PRINT_THIS';\nDeno.env.get('DO_NOT_PRINT_THIS');\nsupabase.from('DO_NOT_PRINT_THIS');\nsupabase.rpc('DO_NOT_PRINT_THIS');\nsupabase.functions.invoke('DO_NOT_PRINT_THIS');\nconst app = 'planipret';\n`);
    writeFileSync(join(migrations, '01.sql'), `CREATE TABLE public.lemtel_calls (id uuid);\nCREATE TABLE public.planipret_calls (id uuid);\n-- DO_NOT_PRINT_THIS\n`);
    const result = inventory(root);
    const output = JSON.stringify(result);
    assert.ok(!output.includes('DO_NOT_PRINT_THIS'));
    assert.equal(result.candidates[0].direct_environment_reference_count, 1);
    assert.equal(result.candidates[0].relative_import_count, 1);
    assert.equal(result.candidates[0].direct_foreign_marker_detected, true);
    assert.equal(result.ddl_candidates[0].lemtel_or_pbx_table_declaration_count, 1);
    assert.equal(result.ddl_candidates[0].direct_foreign_marker_detected, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('inventory imports no network or execution capability', () => {
  const code = readFileSync(resolve(repo, 'scripts/inventory-lemtel-hosting.mjs'), 'utf8');
  assert.doesNotMatch(code, /child_process|spawn\s*\(|exec(?:File)?\s*\(|fetch\s*\(|\.listen\s*\(|writeFile|process\.env\./);
  assert.throws(() => inventory('/missing'), /INVENTORY_INPUTS_MISSING/);
});
