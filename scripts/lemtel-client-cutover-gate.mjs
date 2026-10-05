// Phase 40A — validates an inactive Lemtel client-cutover contract only.
// This module never reads build secrets, changes client configuration, builds, signs, uploads, or deploys.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY_PATH = 'infra/lemtel-client-cutover/client-cutover-gate.json';

const POLICY_KEYS = ['policy_version', 'scope', 'current_state', 'backend_preconditions', 'build_preconditions', 'device_validation', 'rollout'];
const CURRENT_KEYS = ['installed_clients_remain_on_legacy_backend', 'self_hosted_client_cutover_authorized', 'planipret_branch_eligible', 'current_lovable_project_eligible'];
const BACKEND_KEYS = ['hostinger_https_auth_verified', 'hostinger_storage_realtime_functions_verified', 'fresh_encrypted_backup_and_restore_verified', 'approved_lemtel_only_schema_verified', 'edge_functions_deployed_and_smoke_tested', 'private_directory_migration_and_rbac_verified', 'wss_turn_sip_test_environment_verified'];
const BUILD_KEYS = ['private_origin_and_publishable_key_in_build_system', 'new_auth_test_accounts_verified', 'desktop_build_authorized', 'ios_build_authorized', 'android_build_authorized', 'source_maps_private'];
const DEVICE_KEYS = ['desktop_physical_test_passed', 'ios_physical_test_passed', 'android_physical_test_passed', 'incoming_call_lifecycle_passed', 'outgoing_call_media_passed', 'recording_authority_passed', 'rollback_builds_ready'];
const ROLLOUT_KEYS = ['github_release_pipeline_enabled', 'lovable_lemtel_project_connected', 'staged_rollout_authorized', 'store_submission_authorized', 'production_rollout_authorized'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const allFalse = (value) => Object.values(value).every((entry) => entry === false);

export function validateClientCutoverGate(policy) {
  return exactKeys(policy, POLICY_KEYS) &&
    policy.policy_version === 'lemtel_client_cutover_gate_v1' &&
    policy.scope === 'offline_client_cutover_gate_only' &&
    exactKeys(policy.current_state, CURRENT_KEYS) &&
    policy.current_state.installed_clients_remain_on_legacy_backend === true &&
    policy.current_state.self_hosted_client_cutover_authorized === false &&
    policy.current_state.planipret_branch_eligible === false &&
    policy.current_state.current_lovable_project_eligible === false &&
    exactKeys(policy.backend_preconditions, BACKEND_KEYS) && allFalse(policy.backend_preconditions) &&
    exactKeys(policy.build_preconditions, BUILD_KEYS) &&
    policy.build_preconditions.private_origin_and_publishable_key_in_build_system === false &&
    policy.build_preconditions.new_auth_test_accounts_verified === false &&
    policy.build_preconditions.desktop_build_authorized === false &&
    policy.build_preconditions.ios_build_authorized === false &&
    policy.build_preconditions.android_build_authorized === false &&
    policy.build_preconditions.source_maps_private === true &&
    exactKeys(policy.device_validation, DEVICE_KEYS) && allFalse(policy.device_validation) &&
    exactKeys(policy.rollout, ROLLOUT_KEYS) && allFalse(policy.rollout);
}

export function reviewClientCutoverGate(policy) {
  if (!validateClientCutoverGate(policy)) {
    return { status: 'client_cutover_gate_invalid', authorization: false, reasons: ['CLIENT_CUTOVER_GATE_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'client_cutover_blocked',
    authorization: false,
    desktop_build_authorized: false,
    ios_build_authorized: false,
    android_build_authorized: false,
    client_configuration_write_authorized: false,
    store_submission_authorized: false,
    production_rollout_authorized: false,
    reasons: [
      'SELF_HOSTED_BACKEND_AND_LEMTEL_ONLY_SCHEMA_REQUIRED',
      'FRESH_BACKUP_RESTORE_AND_EDGE_SMOKE_TEST_REQUIRED',
      'PRIVATE_BUILD_CONFIGURATION_AND_NEW_AUTH_TEST_ACCOUNTS_REQUIRED',
      'SIP_WSS_TURN_AND_PHYSICAL_DEVICE_VALIDATION_REQUIRED',
      'RECORDING_AUTHORITY_AND_ROLLBACK_BUILD_VALIDATION_REQUIRED',
      'DEDICATED_LOVABLE_LEMTEL_PROJECT_AND_GITHUB_RELEASE_PIPELINE_REQUIRED',
      'EXPLICIT_STAGED_ROLLOUT_AUTHORIZATION_REQUIRED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const policy = JSON.parse(reader(join(root, POLICY_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewClientCutoverGate(policy))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"client_cutover_gate_invalid","authorization":false,"reasons":["CLIENT_CUTOVER_GATE_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
