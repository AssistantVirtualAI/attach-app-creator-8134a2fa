// Phase 32A — offline evidence review only. It never changes policy or starts services.
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PREREQUISITES = [
  'dedicated_vps_hardened', 'key_only_ssh_verified', 'firewall_ssh_only_verified',
  'weekly_hostinger_backup_enabled', 'fresh_prechange_snapshot_created',
  'external_encrypted_backup_approved', 'offserver_restore_test_passed',
  'monitoring_owner_named', 'logs_retention_approved', 'secrets_owner_named',
  'private_dns_and_tls_approved', 'pbx_integration_approved', 'all_edge_gates_false',
];
export const STATES = ['not_provided', 'verified', 'rejected'];
const DOCUMENT_KEYS = ['kind', 'request_id', 'evidence_ref', 'evidence'];
const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const EVIDENCE_DIRECTORY = 'schemas/lemtel-staging-admission/evidence/';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (object, keys) => isObject(object)
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());

export function validateEvidence(document) {
  if (!exactKeys(document, DOCUMENT_KEYS) || document.kind !== 'staging_admission_evidence' ||
      !OPAQUE_ID.test(document.request_id || '') || !OPAQUE_ID.test(document.evidence_ref || '') ||
      !exactKeys(document.evidence, PREREQUISITES)) return false;
  return PREREQUISITES.every((key) => STATES.includes(document.evidence[key]));
}

export function reviewEvidence(document) {
  if (!validateEvidence(document)) {
    return { status: 'evidence_invalid', authorization: false, reasons: ['EVIDENCE_INVALID'] };
  }
  const rejected = PREREQUISITES.filter((key) => document.evidence[key] === 'rejected');
  const missing = PREREQUISITES.filter((key) => document.evidence[key] === 'not_provided');
  const reasons = [
    ...rejected.map((key) => `evidence_rejected_${key}`),
    ...missing.map((key) => `unmet_${key}`),
    'POLICY_REVIEW_REQUIRED',
  ];
  return {
    status: reasons.length === 1 ? 'evidence_complete_not_authorization' : 'evidence_incomplete',
    authorization: false,
    reasons,
  };
}

export function evidencePath(argument, root = ROOT) {
  if (typeof argument !== 'string' || !argument.startsWith('--file=')) return null;
  const candidate = argument.slice('--file='.length);
  if (!candidate.startsWith(EVIDENCE_DIRECTORY) || !candidate.endsWith('.json')) return null;
  const path = resolve(root, candidate);
  return relative(root, path).startsWith(`${EVIDENCE_DIRECTORY}`) ? path : null;
}

export function run(args, root = ROOT, reader = readFileSync) {
  const path = args.length === 1 ? evidencePath(args[0], root) : null;
  if (!path) {
    return { code: 2, stdout: 'USAGE: node scripts/lemtel-hosting-admission-evidence.mjs --file=schemas/lemtel-staging-admission/evidence/<non-secret>.json\n' };
  }
  let document;
  try { document = JSON.parse(reader(path, 'utf8')); }
  catch { return { code: 78, stdout: '{"status":"evidence_invalid","authorization":false,"reasons":["EVIDENCE_UNREADABLE"]}\n' }; }
  // Intentionally omit the supplied IDs and every input value from output.
  return { code: 78, stdout: `${JSON.stringify(reviewEvidence(document))}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
