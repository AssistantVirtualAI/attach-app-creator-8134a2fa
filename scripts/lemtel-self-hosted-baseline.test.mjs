import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASELINE_DOMAINS, composeBaseline, run } from './lemtel-self-hosted-baseline.mjs';

const repo = resolve(import.meta.dirname, '..');
const inventory = (overrides = {}) => ({
  status: 'discovery_only_manual_review_required',
  database_export_authorized: false,
  migration_replay_authorized: false,
  functions_deploy_authorized: false,
  candidates: [{ function: 'lemtel-clean', entrypoint_present: true, direct_foreign_marker_detected: false }],
  ddl_candidates: [{ file: '01.sql', lemtel_or_pbx_table_declaration_count: 1, direct_foreign_marker_detected: false }],
  ...overrides,
});
const closure = (overrides = {}) => ({
  status: 'incomplete_manual_review_required',
  source_analysis_only: true,
  database_export_authorized: false,
  migration_replay_authorized: false,
  functions_deploy_authorized: false,
  findings_are_not_allowlist: true,
  client_dependencies: [],
  function_import_closures: [{
    function: 'lemtel-clean', direct_foreign_marker_detected: false,
    indirect_foreign_marker_detected: false, unresolved_relative_import_count: 0,
  }],
  ...overrides,
});

test('baseline reports every required domain but never authorizes import, deployment or client cutover', () => {
  const result = composeBaseline(inventory(), closure());
  assert.equal(result.status, 'baseline_review_not_migration');
  assert.equal(result.authorization, false);
  assert.equal(result.source_analysis_only, true);
  for (const key of ['source_data_import_authorized', 'target_schema_write_authorized', 'auth_import_authorized',
    'storage_import_authorized', 'functions_deploy_authorized', 'client_cutover_authorized']) {
    assert.equal(result[key], false, key);
  }
  assert.deepEqual(result.baseline_domains, BASELINE_DOMAINS.map(([domain, status]) => ({ domain, status })));
  assert.deepEqual(result.function_review, [{
    function: 'lemtel-clean', entrypoint_present: true, client_reference_count: 0,
    foreign_or_cross_product_marker_detected: false, unresolved_relative_import_count: 0,
    review_outcome: 'manual_schema_function_review_required',
  }]);
  assert.deepEqual(result.migration_review, [{
    migration: '01.sql', lemtel_or_pbx_table_declaration_count: 1, foreign_marker_detected: false,
    review_outcome: 'manual_ddl_dependency_review_required',
  }]);
});

test('foreign, cross-product and unresolved findings remain blocked instead of becoming a migration allowlist', () => {
  const report = composeBaseline(inventory({
    candidates: [
      { function: 'lemtel-foreign', entrypoint_present: true, direct_foreign_marker_detected: true },
      { function: 'lemtel-unresolved', entrypoint_present: true, direct_foreign_marker_detected: false },
      { function: 'lemtel-cross', entrypoint_present: true, direct_foreign_marker_detected: false },
    ],
    ddl_candidates: [{ file: 'foreign.sql', lemtel_or_pbx_table_declaration_count: 1, direct_foreign_marker_detected: true }],
  }), closure({
    client_dependencies: [{ function: 'lemtel-cross', clients: ['ava-softphone-mobile'], cross_product_marker: true }],
    function_import_closures: [
      { function: 'lemtel-foreign', direct_foreign_marker_detected: true, indirect_foreign_marker_detected: false, unresolved_relative_import_count: 0 },
      { function: 'lemtel-unresolved', direct_foreign_marker_detected: false, indirect_foreign_marker_detected: false, unresolved_relative_import_count: 1 },
      { function: 'lemtel-cross', direct_foreign_marker_detected: false, indirect_foreign_marker_detected: false, unresolved_relative_import_count: 0 },
    ],
  }));
  assert.deepEqual(report.function_review.map((item) => item.review_outcome), [
    'blocked_cross_product_marker', 'blocked_foreign_marker', 'blocked_unresolved_import',
  ]);
  assert.equal(report.migration_review[0].review_outcome, 'blocked_foreign_marker');
  assert.ok(!JSON.stringify(report).includes('DO_NOT_PRINT_THIS'));
});

test('invalid or permission-lifted audit input fails closed', () => {
  assert.deepEqual(composeBaseline(inventory({ migration_replay_authorized: true }), closure()), {
    status: 'baseline_input_invalid', authorization: false,
    reasons: ['STATIC_AUDIT_INPUT_INVALID', 'POLICY_REVIEW_REQUIRED'],
  });
  assert.deepEqual(composeBaseline(inventory(), closure({ findings_are_not_allowlist: false })), {
    status: 'baseline_input_invalid', authorization: false,
    reasons: ['STATIC_AUDIT_INPUT_INVALID', 'POLICY_REVIEW_REQUIRED'],
  });
});

test('actual baseline is deterministic and keeps all migration capabilities disabled', () => {
  const first = run(repo);
  const second = run(repo);
  assert.equal(first.code, 78);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.status, 'baseline_review_not_migration');
  assert.ok(report.function_review.some((item) => item.function === 'get-turn-credentials'));
  assert.ok(report.function_review.every((item) => item.review_outcome !== 'approved'));
  assert.ok(report.migration_review.every((item) => item.review_outcome !== 'approved'));
});

test('baseline source has no network, process launch, write, environment or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-baseline.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
