// Phase 31B: offline, read-only guard for the *future* hosting entrypoint.
// This tool intentionally cannot authorize deployment under the phase-14 v1 policy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const POLICY = 'schemas/lemtel-staging-admission/staging-admission-policy.json';
const CAPABILITIES = ['deployment_allowed', 'runtime_allowed', 'persistent_data_allowed', 'secrets_allowed', 'network_allowed'];
const PREREQUISITES = [
  'dedicated_vps_hardened', 'key_only_ssh_verified', 'firewall_ssh_only_verified',
  'weekly_hostinger_backup_enabled', 'fresh_prechange_snapshot_created',
  'external_encrypted_backup_approved', 'offserver_restore_test_passed',
  'monitoring_owner_named', 'logs_retention_approved', 'secrets_owner_named',
  'private_dns_and_tls_approved', 'pbx_integration_approved', 'all_edge_gates_false',
];
const KEYS = [
  'policy_version', 'offline_only', ...CAPABILITIES, 'allowed_decisions',
  'default_decision', 'current_decision', 'current_reason_codes', 'prerequisites',
];
const sameKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());

export function evaluate(policy) {
  if (!sameKeys(policy, KEYS) || !sameKeys(policy.prerequisites, PREREQUISITES) ||
      !CAPABILITIES.every((key) => typeof policy[key] === 'boolean') ||
      !PREREQUISITES.every((key) => typeof policy.prerequisites[key] === 'boolean') ||
      !Array.isArray(policy.current_reason_codes) ||
      !policy.current_reason_codes.every((reason) => typeof reason === 'string') ||
      JSON.stringify(policy.allowed_decisions) !== JSON.stringify(['denied', 'admitted']) ||
      policy.default_decision !== 'denied' || !['denied', 'admitted'].includes(policy.current_decision)) {
    return ['POLICY_INVALID'];
  }
  // Phase 14 v1 grants *zero* operational capabilities, including for a hypothetical
  // "admitted" decision. A later separately reviewed phase must define a new contract.
  if (policy.policy_version !== 'staging_admission_policy_v1') return ['POLICY_UNREVIEWED'];
  const missing = PREREQUISITES.filter((name) => !policy.prerequisites[name]);
  const reasons = missing.map((name) => `unmet_${name}`);
  if (policy.offline_only !== true || CAPABILITIES.some((key) => policy[key] !== false) ||
      policy.current_decision !== 'denied' ||
      JSON.stringify(policy.current_reason_codes) !== JSON.stringify(reasons)) {
    return ['POLICY_UNREVIEWED'];
  }
  return ['ADMISSION_DENIED'];
}

export function run(args, root = ROOT) {
  const target = args.find((arg) => arg.startsWith('--target='))?.slice(9);
  const mode = args.find((arg) => arg === '--verify' || arg === '--report');
  if (args.length !== 2 || !['--verify', '--report'].includes(mode) ||
      !['hostinger-primary', 'digitalocean-standby'].includes(target)) {
    return { code: 2, stdout: 'HOSTING_USAGE: --verify|--report --target=hostinger-primary|digitalocean-standby\n' };
  }
  let policy;
  try { policy = JSON.parse(readFileSync(resolve(root, POLICY), 'utf8')); }
  catch { return { code: 78, stdout: 'HOSTING_BLOCKED: POLICY_UNREADABLE\n' }; }
  const reasons = evaluate(policy);
  if (mode === '--verify') return { code: 78, stdout: `HOSTING_BLOCKED: ${reasons[0]}\n` };
  return { code: 78, stdout: `${JSON.stringify({ target, status: 'blocked', reasons })}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
