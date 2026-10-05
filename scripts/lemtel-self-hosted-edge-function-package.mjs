// Phase 37A — validates a local Edge Function deployment package only; it never copies, deploys or contacts a host.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const MANIFEST_PATH = 'infra/lemtel-self-hosted/edge-functions/deployment-manifest.json';

const PACKAGE_KEYS = ['package_version', 'scope', 'deployment_authorized', 'client_cutover_authorized', 'data_import_authorized', 'secrets_in_bundle', 'runtime', 'required_runtime_paths', 'functions', 'deployment_prerequisites'];
const RUNTIME_KEYS = ['function_volume_mount', 'router_path', 'import_map_path', 'post_copy_action'];
const FUNCTION_KEYS = ['slug', 'source', 'destination', 'source_sha256'];
const EXPECTED_FUNCTIONS = [
  {
    slug: 'lemtel-mobile-config-admin',
    source: 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-admin/index.ts',
    destination: 'lemtel-mobile-config-admin/index.ts',
  },
  {
    slug: 'lemtel-mobile-config-manifest',
    source: 'infra/lemtel-self-hosted/functions/lemtel-mobile-config-manifest/index.ts',
    destination: 'lemtel-mobile-config-manifest/index.ts',
  },
];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const includesAll = (value, expected) => Array.isArray(value) && expected.every((item) => value.includes(item));
const validSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const validSource = (value) => typeof value === 'string' && /^infra\/lemtel-self-hosted\/functions\/lemtel-mobile-config-(?:admin|manifest)\/index\.ts$/u.test(value);
const validDestination = (value) => typeof value === 'string' && /^lemtel-mobile-config-(?:admin|manifest)\/index\.ts$/u.test(value);

export function sourceDigest(root, relativePath, reader = readFileSync) {
  if (!validSource(relativePath)) return null;
  try { return createHash('sha256').update(reader(join(root, relativePath))).digest('hex'); } catch { return null; }
}

export function validateEdgeFunctionDeploymentPackage(pkg, root = ROOT, reader = readFileSync) {
  if (!exactKeys(pkg, PACKAGE_KEYS) ||
      pkg.package_version !== 'lemtel_edge_function_deployment_v1' ||
      pkg.scope !== 'offline_edge_function_deployment_package' ||
      pkg.deployment_authorized !== false ||
      pkg.client_cutover_authorized !== false ||
      pkg.data_import_authorized !== false ||
      pkg.secrets_in_bundle !== false ||
      !exactKeys(pkg.runtime, RUNTIME_KEYS) ||
      pkg.runtime.function_volume_mount !== '/home/deno/functions' ||
      pkg.runtime.router_path !== 'main/index.ts' ||
      pkg.runtime.import_map_path !== 'deno.jsonc' ||
      pkg.runtime.post_copy_action !== 'functions_service_restart_and_read_only_smoke_test' ||
      !includesAll(pkg.required_runtime_paths, ['main/index.ts', 'deno.jsonc']) ||
      !includesAll(pkg.deployment_prerequisites, ['fresh_snapshot', 'edge_runtime_healthy', 'function_router_and_import_map_verified', 'approved_edge_deployment', 'owner_rbac_validation', 'read_only_smoke_test'])) return false;

  if (!Array.isArray(pkg.functions) || pkg.functions.length !== EXPECTED_FUNCTIONS.length) return false;
  for (let index = 0; index < EXPECTED_FUNCTIONS.length; index += 1) {
    const expected = EXPECTED_FUNCTIONS[index];
    const candidate = pkg.functions[index];
    if (!exactKeys(candidate, FUNCTION_KEYS) || candidate.slug !== expected.slug || candidate.source !== expected.source ||
        candidate.destination !== expected.destination || !validSource(candidate.source) || !validDestination(candidate.destination) ||
        !validSha256(candidate.source_sha256) || candidate.source_sha256 !== sourceDigest(root, candidate.source, reader)) return false;
  }
  return true;
}

export function reviewEdgeFunctionDeploymentPackage(pkg, root = ROOT, reader = readFileSync) {
  if (!validateEdgeFunctionDeploymentPackage(pkg, root, reader)) {
    return { status: 'edge_function_package_invalid', authorization: false, reasons: ['EDGE_FUNCTION_PACKAGE_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'edge_function_package_offline_ready',
    authorization: false,
    external_write_authorized: false,
    functions_restart_authorized: false,
    client_cutover_authorized: false,
    functions: pkg.functions.map(({ slug }) => slug),
    reasons: [
      'FRESH_SNAPSHOT_REQUIRED',
      'EDGE_RUNTIME_ROUTER_AND_IMPORT_MAP_RECHECK_REQUIRED',
      'APPROVED_EDGE_DEPLOYMENT_REQUIRED',
      'OWNER_RBAC_AND_READ_ONLY_MANIFEST_SMOKE_TEST_REQUIRED',
      'CLIENT_CUTOVER_NOT_AUTHORIZED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const pkg = JSON.parse(reader(join(root, MANIFEST_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewEdgeFunctionDeploymentPackage(pkg, root, reader))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"edge_function_package_invalid","authorization":false,"reasons":["EDGE_FUNCTION_PACKAGE_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
