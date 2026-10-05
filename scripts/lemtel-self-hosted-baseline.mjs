// Phase 33A — compose a static Lemtel-only review baseline.
// It never exports source data, replays SQL, deploys functions, changes a host, or authorizes a cutover.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './inventory-lemtel-hosting.mjs';
import { audit } from './lemtel-dependency-closure.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const BASELINE_DOMAINS = Object.freeze([
  ['auth', 'new_lemtel_identity_model_required'],
  ['database', 'new_lemtel_schema_and_rls_required'],
  ['storage', 'new_lemtel_buckets_and_policies_required'],
  ['functions', 'per_function_manual_design_required'],
  ['realtime', 'new_lemtel_channels_and_policies_required'],
  ['push', 'new_provider_configuration_required'],
  ['turn', 'new_authorized_issuer_required'],
  ['backup_restore', 'separate_restore_test_and_approval_required'],
]);

function validInventory(report) {
  return report?.status === 'discovery_only_manual_review_required' &&
    report.database_export_authorized === false && report.migration_replay_authorized === false &&
    report.functions_deploy_authorized === false && Array.isArray(report.candidates) &&
    Array.isArray(report.ddl_candidates);
}

function validAudit(report) {
  return report?.status === 'incomplete_manual_review_required' && report.source_analysis_only === true &&
    report.database_export_authorized === false && report.migration_replay_authorized === false &&
    report.functions_deploy_authorized === false && report.findings_are_not_allowlist === true &&
    Array.isArray(report.client_dependencies) && Array.isArray(report.function_import_closures);
}

function functionOutcome(candidate, closure, dependency) {
  if (dependency?.cross_product_marker) return 'blocked_cross_product_marker';
  if (candidate.direct_foreign_marker_detected || closure?.direct_foreign_marker_detected || closure?.indirect_foreign_marker_detected) {
    return 'blocked_foreign_marker';
  }
  if (!closure || closure.unresolved_relative_import_count > 0) return 'blocked_unresolved_import';
  return 'manual_schema_function_review_required';
}

export function composeBaseline(inventoryReport, auditReport) {
  if (!validInventory(inventoryReport) || !validAudit(auditReport)) {
    return {
      status: 'baseline_input_invalid',
      authorization: false,
      reasons: ['STATIC_AUDIT_INPUT_INVALID', 'POLICY_REVIEW_REQUIRED'],
    };
  }

  const closures = new Map(auditReport.function_import_closures.map((item) => [item.function, item]));
  const dependencies = new Map(auditReport.client_dependencies.map((item) => [item.function, item]));
  const functions = inventoryReport.candidates.map((candidate) => {
    const closure = closures.get(candidate.function);
    const dependency = dependencies.get(candidate.function);
    return {
      function: candidate.function,
      entrypoint_present: candidate.entrypoint_present,
      client_reference_count: dependency ? dependency.clients.length : 0,
      foreign_or_cross_product_marker_detected: Boolean(
        candidate.direct_foreign_marker_detected || closure?.direct_foreign_marker_detected ||
        closure?.indirect_foreign_marker_detected || dependency?.cross_product_marker,
      ),
      unresolved_relative_import_count: closure?.unresolved_relative_import_count ?? null,
      review_outcome: functionOutcome(candidate, closure, dependency),
    };
  }).sort((a, b) => a.function.localeCompare(b.function, 'en'));

  const migrations = inventoryReport.ddl_candidates.map((candidate) => ({
    migration: candidate.file,
    lemtel_or_pbx_table_declaration_count: candidate.lemtel_or_pbx_table_declaration_count,
    foreign_marker_detected: candidate.direct_foreign_marker_detected,
    review_outcome: candidate.direct_foreign_marker_detected
      ? 'blocked_foreign_marker'
      : 'manual_ddl_dependency_review_required',
  }));

  return {
    status: 'baseline_review_not_migration',
    authorization: false,
    source_analysis_only: true,
    source_data_import_authorized: false,
    target_schema_write_authorized: false,
    auth_import_authorized: false,
    storage_import_authorized: false,
    functions_deploy_authorized: false,
    client_cutover_authorized: false,
    baseline_domains: BASELINE_DOMAINS.map(([domain, status]) => ({ domain, status })),
    function_review: functions,
    migration_review: migrations,
    reasons: [
      'NO_SHARED_DATA_IMPORT',
      'PER_ITEM_MANUAL_REVIEW_REQUIRED',
      'EXPLICIT_MIGRATION_APPROVAL_REQUIRED',
      'CLIENT_CUTOVER_NOT_AUTHORIZED',
    ],
  };
}

export function run(root = ROOT) {
  return {
    code: 78,
    stdout: `${JSON.stringify(composeBaseline(inventory(root), audit(root)))}\n`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
