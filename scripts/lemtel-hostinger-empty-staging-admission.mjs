// Phase 32B — narrow, expiring admission decision. This file never runs a VPS command.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY = 'schemas/lemtel-hostinger-empty-staging/policy.json';
export const ALLOWED_ACTIONS = [
  'create_empty_persistent_volumes', 'generate_host_local_secrets',
  'install_official_supabase_docker', 'install_reverse_proxy', 'issue_tls_certificate',
  'open_ingress_ports_80_443', 'verify_auth_api',
];
export const FORBIDDEN_ACTIONS = [
  'client_cutover', 'digitalocean_change', 'fusionpbx_change', 'pbx_credentials',
  'planipret_data_access', 'planipret_data_migration', 'production_user_onboarding',
];
const KEYS = [
  'policy_version', 'admission_ref', 'scope', 'decision', 'expires_at', 'snapshot_current_checked',
  'monitoring_owner_confirmed', 'secrets_owner_confirmed', 'logs_retention_days',
  'allowed_actions', 'forbidden_actions',
];
const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
const sameList = (value, expected) => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);

export function evaluate(policy, now = Date.now()) {
  if (!exactKeys(policy, KEYS) || policy.policy_version !== 'lemtel_hostinger_empty_staging_v1' ||
      !OPAQUE_ID.test(policy.admission_ref || '') || policy.scope !== 'hostinger_empty_staging' ||
      policy.decision !== 'admitted' || !sameList(policy.allowed_actions, ALLOWED_ACTIONS) ||
      !sameList(policy.forbidden_actions, FORBIDDEN_ACTIONS) ||
      typeof policy.snapshot_current_checked !== 'boolean' ||
      typeof policy.monitoring_owner_confirmed !== 'boolean' ||
      typeof policy.secrets_owner_confirmed !== 'boolean' || policy.logs_retention_days !== 30) {
    return ['POLICY_INVALID'];
  }
  const expiresAt = Date.parse(policy.expires_at);
  if (!Number.isFinite(expiresAt)) return ['POLICY_INVALID'];
  if (now >= expiresAt) return ['AUTHORIZATION_EXPIRED'];
  const unmet = [
    ['snapshot_current_checked', policy.snapshot_current_checked],
    ['monitoring_owner_confirmed', policy.monitoring_owner_confirmed],
    ['secrets_owner_confirmed', policy.secrets_owner_confirmed],
  ].filter(([, value]) => !value).map(([key]) => `unmet_${key}`);
  return unmet.length ? unmet : ['HOSTINGER_EMPTY_STAGING_ADMITTED'];
}

export function run(args, root = ROOT, now = Date.now()) {
  const mode = args[0];
  if (args.length !== 1 || !['--verify', '--report'].includes(mode)) {
    return { code: 2, stdout: 'USAGE: node scripts/lemtel-hostinger-empty-staging-admission.mjs --verify|--report\n' };
  }
  let policy;
  try { policy = JSON.parse(readFileSync(resolve(root, POLICY), 'utf8')); }
  catch { return { code: 78, stdout: 'HOSTINGER_EMPTY_STAGING_BLOCKED: POLICY_UNREADABLE\n' }; }
  const reasons = evaluate(policy, now);
  const admitted = reasons.length === 1 && reasons[0] === 'HOSTINGER_EMPTY_STAGING_ADMITTED';
  if (mode === '--verify') return { code: admitted ? 0 : 78, stdout: admitted
    ? 'HOSTINGER_EMPTY_STAGING_ADMITTED\n' : `HOSTINGER_EMPTY_STAGING_BLOCKED: ${reasons[0]}\n` };
  return { code: admitted ? 0 : 78, stdout: `${JSON.stringify({
    target: 'hostinger-primary', scope: 'empty_staging_only', status: admitted ? 'admitted' : 'blocked',
    authorization: admitted ? 'manual_staging_commands_only' : 'none', reasons,
  })}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
