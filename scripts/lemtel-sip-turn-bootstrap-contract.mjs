import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const contractPath = path.join(root, 'infra/lemtel-self-hosted/sip-turn-bootstrap-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

const forbidden = new Set(['copy_or_import_Planipret_credentials_or_configuration', 'embed_or_commit_SIP_TURN_PBX_or_push_secrets', 'modify_FusionPBX', 'enable_client_build_flags', 'change_desktop_iOS_or_Android_backend_origin', 'deploy_or_expose_new_runtime_endpoints']);
const requiredEvidence = new Set(['Kenny_or_Phil_provide_test_extension_assignment_and_sip_wss_endpoint', 'TURN_provider_hostname_ports_auth_mode_and_short_lived_credential_policy', 'approved_test_call_matrix_for_inbound_outbound_media_and_failure_cases', 'iOS_PushKit_CallKit_and_Android_FCM_lifecycle_test_plan', 'backup_and_restore_evidence_for_any_new_Lemtel_owned_configuration']);

export function validateContract(value = contract) {
  const errors = [];
  if (value.scope !== 'offline_contract_only') errors.push('scope must stay offline');
  for (const key of ['deployment_authorized', 'client_activation_authorized', 'fusionpbx_change_authorized', 'secrets_in_contract']) if (value[key] !== false) errors.push(`${key} must be false`);
  if (!Array.isArray(value.issuers) || value.issuers.length !== 3) errors.push('exactly three blocked issuers required');
  for (const issuer of value.issuers ?? []) {
    if (!issuer.status?.startsWith('blocked_')) errors.push(`${issuer.slug} must remain blocked`);
    if (issuer.auth !== 'authenticated_active_lemtel_member') errors.push(`${issuer.slug} must require active membership`);
    if (issuer.forbidden_response_fields?.some((field) => /secret|password|admin|service_role/i.test(field)) === false) errors.push(`${issuer.slug} must deny sensitive fields`);
  }
  for (const item of forbidden) if (!value.forbidden_actions?.includes(item)) errors.push(`missing forbidden action ${item}`);
  for (const item of requiredEvidence) if (!value.required_external_evidence_before_implementation?.includes(item)) errors.push(`missing required evidence ${item}`);
  return { ok: errors.length === 0, errors };
}

const result = validateContract();
if (!result.ok) { console.error(result.errors.join('\n')); process.exit(1); }
console.log('lemtel sip/turn bootstrap contract: blocked and valid');
