import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewDispositionRegistry, run, validateDispositionRegistry } from './lemtel-blocked-function-dispositions.mjs';

const repo = resolve(import.meta.dirname, '..');
const baseline = (functions = [{ function: 'lemtel-blocked', review_outcome: 'blocked_foreign_marker' }]) => ({ function_review: functions });
const registry = (functions = [{
  function: 'lemtel-blocked', disposition: 'reimplement_new_lemtel_service', prerequisite_categories: ['access_control'],
}]) => ({
  policy_version: 'lemtel_blocked_function_dispositions_v1', scope: 'static_review_only', authorization: false, functions,
});

test('reviewed registry matches every currently blocked function but stays non-authorizing', () => {
  const result = reviewDispositionRegistry(registry(), baseline());
  assert.equal(result.status, 'blocked_function_dispositions_reviewed');
  assert.equal(result.authorization, false);
  for (const key of ['source_data_import_authorized', 'function_implementation_authorized', 'functions_deploy_authorized', 'client_cutover_authorized']) {
    assert.equal(result[key], false, key);
  }
  assert.deepEqual(result.disposition_counts, [
    { disposition: 'exclude_pending_replacement', count: 0 },
    { disposition: 'manual_boundary_trace_required', count: 0 },
    { disposition: 'reimplement_new_lemtel_service', count: 1 },
  ]);
});

test('missing, added, duplicated, permission-lifted or unrecognized decisions fail closed', () => {
  assert.equal(validateDispositionRegistry(registry([]), baseline()), false);
  assert.equal(validateDispositionRegistry(registry(), {}), false);
  assert.equal(validateDispositionRegistry(registry([{ function: 'lemtel-blocked', disposition: 'approved', prerequisite_categories: ['access_control'] }]), baseline()), false);
  assert.equal(validateDispositionRegistry(registry([{ function: 'lemtel-blocked', disposition: 'reimplement_new_lemtel_service', prerequisite_categories: [] }]), baseline()), false);
  const duplicate = registry([{ function: 'lemtel-blocked', disposition: 'reimplement_new_lemtel_service', prerequisite_categories: ['access_control'] }, { function: 'lemtel-blocked', disposition: 'exclude_pending_replacement', prerequisite_categories: ['access_control'] }]);
  assert.equal(validateDispositionRegistry(duplicate, baseline([{ function: 'lemtel-blocked', review_outcome: 'blocked_foreign_marker' }, { function: 'lemtel-other', review_outcome: 'blocked_unresolved_import' }])), false);
  const lifted = registry(); lifted.authorization = true;
  assert.deepEqual(reviewDispositionRegistry(lifted, baseline()), {
    status: 'blocked_function_registry_invalid', authorization: false, reasons: ['REGISTRY_INVALID', 'POLICY_REVIEW_REQUIRED'],
  });
});

test('actual review registry covers all baseline blockers and keeps every implementation capability disabled', () => {
  const result = run(repo);
  assert.equal(result.code, 78);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'blocked_function_dispositions_reviewed');
  assert.deepEqual(report.disposition_counts, [
    { disposition: 'exclude_pending_replacement', count: 2 },
    { disposition: 'manual_boundary_trace_required', count: 4 },
    { disposition: 'reimplement_new_lemtel_service', count: 4 },
  ]);
  assert.equal(report.function_implementation_authorized, false);
  assert.equal(report.functions_deploy_authorized, false);
});

test('registry validator has no network, process launch, write, environment or deployment capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-blocked-function-dispositions.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
