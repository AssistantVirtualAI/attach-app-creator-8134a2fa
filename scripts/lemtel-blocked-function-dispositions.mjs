// Phase 33B — validates a static review registry. It never implements, deploys, imports or authorizes a function.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as baselineRun } from './lemtel-self-hosted-baseline.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY = 'schemas/lemtel-self-hosted-baseline/blocked-function-dispositions.json';
const DOCUMENT_KEYS = ['policy_version', 'scope', 'authorization', 'functions'];
const FUNCTION_KEYS = ['function', 'disposition', 'prerequisite_categories'];
const DISPOSITIONS = new Set([
  'manual_boundary_trace_required',
  'reimplement_new_lemtel_service',
  'exclude_pending_replacement',
]);
const PREREQUISITES = new Set([
  'access_control', 'action_effect_inventory', 'artifact_integrity', 'auditability', 'authorization_parity', 'consent_and_retention',
  'data_minimization', 'external_boundary', 'fallback_behavior', 'media_contract', 'replacement_ownership',
  'rollback', 'synthetic_validation', 'tenant_boundary', 'validation_contract', 'version_policy',
]);
const IDENTIFIER = /^[a-z][a-z0-9-]{2,79}$/;

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateDispositionRegistry(registry, baseline) {
  if (!exactKeys(registry, DOCUMENT_KEYS) || registry.policy_version !== 'lemtel_blocked_function_dispositions_v1' ||
      registry.scope !== 'static_review_only' || registry.authorization !== false || !Array.isArray(registry.functions)) return false;
  if (!Array.isArray(baseline?.function_review)) return false;
  const blocked = baseline.function_review.filter((item) => item.review_outcome?.startsWith('blocked_'))
    .map((item) => item.function).sort();
  if (registry.functions.length !== blocked.length) return false;
  const seen = new Set();
  for (const item of registry.functions) {
    if (!exactKeys(item, FUNCTION_KEYS) || !IDENTIFIER.test(item.function || '') || !DISPOSITIONS.has(item.disposition) ||
        !Array.isArray(item.prerequisite_categories) || item.prerequisite_categories.length === 0 ||
        item.prerequisite_categories.some((entry) => !PREREQUISITES.has(entry)) || seen.has(item.function)) return false;
    seen.add(item.function);
  }
  return JSON.stringify([...seen].sort()) === JSON.stringify(blocked);
}

export function reviewDispositionRegistry(registry, baseline) {
  if (!validateDispositionRegistry(registry, baseline)) {
    return { status: 'blocked_function_registry_invalid', authorization: false, reasons: ['REGISTRY_INVALID', 'POLICY_REVIEW_REQUIRED'] };
  }
  const counts = [...DISPOSITIONS].sort().map((disposition) => ({
    disposition,
    count: registry.functions.filter((item) => item.disposition === disposition).length,
  }));
  return {
    status: 'blocked_function_dispositions_reviewed',
    authorization: false,
    source_analysis_only: true,
    source_data_import_authorized: false,
    function_implementation_authorized: false,
    functions_deploy_authorized: false,
    client_cutover_authorized: false,
    disposition_counts: counts,
    reasons: ['EXPLICIT_IMPLEMENTATION_APPROVAL_REQUIRED', 'NO_SHARED_DATA_IMPORT', 'CLIENT_CUTOVER_NOT_AUTHORIZED'],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  let registry;
  let baseline;
  try {
    registry = JSON.parse(reader(join(root, REGISTRY), 'utf8'));
    baseline = JSON.parse(baselineRun(root).stdout);
  } catch {
    return { code: 78, stdout: '{"status":"blocked_function_registry_invalid","authorization":false,"reasons":["REGISTRY_UNREADABLE","POLICY_REVIEW_REQUIRED"]}\n' };
  }
  return { code: 78, stdout: `${JSON.stringify(reviewDispositionRegistry(registry, baseline))}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
