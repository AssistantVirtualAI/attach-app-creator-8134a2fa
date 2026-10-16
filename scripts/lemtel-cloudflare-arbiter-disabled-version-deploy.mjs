#!/usr/bin/env node
/**
 * Source-only Cloudflare Worker version deployer.
 *
 * This module intentionally has no remote side effect unless `runDeployment()`
 * receives every local gate and LEMTEL_CF_DRY_RUN is not true.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile as readFileFromDisk } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_NAME = 'lemtel-failover-arbiter';
export const WORKER_SOURCE_RELATIVE_PATH =
  'infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
export const MAIN_MODULE_NAME = 'lemtel-failover-arbiter-worker.mjs';
export const INTENT_ENV = 'LEMTEL_CF_DEPLOY_INTENT';
export const INTENT_VALUE = 'LEMTEL_CF_DEPLOY_DISABLED_VERSION_V1';
export const API_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN';
export const ACCOUNT_ID_ENV = 'LEMTEL_CF_TARGET_ACCOUNT_ID';
export const WORKER_NAME_ENV = 'LEMTEL_CF_WORKER_NAME';
export const SOURCE_SHA256_ENV = 'LEMTEL_CF_EXPECTED_SOURCE_SHA256';
export const COMPATIBILITY_DATE_ENV = 'LEMTEL_CF_COMPATIBILITY_DATE';
export const DRY_RUN_ENV = 'LEMTEL_CF_DRY_RUN';
export const ALLOWED_INHERITED_BINDINGS = Object.freeze([
  'STATE',
  'FAILOVER_MODE',
  'CONFIG_REVISION',
  'ARBITER_SERIALIZATION_ACK',
]);

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_SOURCE_PATH = resolve(REPOSITORY_ROOT, WORKER_SOURCE_RELATIVE_PATH);

export class DeploymentGateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DeploymentGateError';
    this.code = code;
  }
}

function requireExact(value, expected, code) {
  if (value !== expected) throw new DeploymentGateError(code);
  return value;
}

function requireNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new DeploymentGateError(code);
  return value;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireSourceHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new DeploymentGateError('expected_source_sha256_must_be_lowercase_hex');
  }
  return value;
}

function hashesMatch(expected, actual) {
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function normaliseSource(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new DeploymentGateError('worker_source_must_be_bytes');
}

function localConfiguration(env, argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new DeploymentGateError('cli_arguments_are_not_allowed');
  }

  requireExact(env[INTENT_ENV], INTENT_VALUE, 'deploy_intent_not_confirmed');
  requireExact(env.FAILOVER_MODE, 'disabled', 'failover_mode_must_be_disabled');
  requireExact(env[WORKER_NAME_ENV], WORKER_NAME, 'worker_name_not_allowed');

  const accountId = requireNonEmptyString(env[ACCOUNT_ID_ENV], 'target_account_id_required');
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new DeploymentGateError('target_account_id_must_be_lowercase_hex');
  }

  const compatibilityDate = requireNonEmptyString(
    env[COMPATIBILITY_DATE_ENV],
    'compatibility_date_required',
  );
  if (!isCalendarDate(compatibilityDate)) {
    throw new DeploymentGateError('compatibility_date_must_be_calendar_date');
  }

  const expectedSourceSha256 = requireSourceHash(env[SOURCE_SHA256_ENV]);
  const dryRunValue = env[DRY_RUN_ENV];
  if (dryRunValue !== undefined && dryRunValue !== 'true') {
    throw new DeploymentGateError('dry_run_must_be_true_when_set');
  }
  const dryRun = dryRunValue === 'true';
  const apiToken = dryRun ? env[API_TOKEN_ENV] ?? '' : requireNonEmptyString(
    env[API_TOKEN_ENV],
    'api_token_required_at_runtime',
  );

  return {
    accountId,
    apiToken,
    compatibilityDate,
    expectedSourceSha256,
    dryRun,
  };
}

export function buildVersionMetadata(compatibilityDate) {
  if (!isCalendarDate(compatibilityDate)) {
    throw new DeploymentGateError('compatibility_date_must_be_calendar_date');
  }

  return {
    main_module: MAIN_MODULE_NAME,
    compatibility_date: compatibilityDate,
    bindings: ALLOWED_INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })),
  };
}

export function buildVersionMultipart(source, compatibilityDate) {
  const sourceBytes = normaliseSource(source);
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(buildVersionMetadata(compatibilityDate))], { type: 'application/json' }),
    'metadata.json',
  );
  form.append(
    MAIN_MODULE_NAME,
    new Blob([sourceBytes], { type: 'application/javascript+module' }),
    MAIN_MODULE_NAME,
  );
  return form;
}

function versionUploadURL(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/versions?bindings_inherit=strict`;
}

function deploymentURL(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/deployments`;
}

function settingsURL(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/settings`;
}

function assertRemoteDisabledSettings(payload) {
  const bindings = payload?.result?.bindings;
  if (!Array.isArray(bindings)) {
    throw new DeploymentGateError('worker_settings_response_invalid');
  }

  const byName = new Map();
  for (const binding of bindings) {
    if (!binding || typeof binding.name !== 'string' || byName.has(binding.name)) {
      throw new DeploymentGateError('worker_settings_response_invalid');
    }
    byName.set(binding.name, binding);
  }

  if (byName.size !== ALLOWED_INHERITED_BINDINGS.length ||
      !ALLOWED_INHERITED_BINDINGS.every((name) => byName.has(name))) {
    throw new DeploymentGateError('remote_bindings_not_allowlisted');
  }

  const failoverMode = byName.get('FAILOVER_MODE');
  if (failoverMode.type !== 'plain_text' || failoverMode.text !== 'disabled') {
    throw new DeploymentGateError('remote_failover_mode_not_disabled');
  }
}

async function readAndVerifySource({ sourcePath, readFile, expectedSourceSha256 }) {
  let source;
  try {
    source = normaliseSource(await readFile(sourcePath));
  } catch (error) {
    if (error instanceof DeploymentGateError) throw error;
    throw new DeploymentGateError('worker_source_unreadable');
  }

  const actualSourceSha256 = createHash('sha256').update(source).digest('hex');
  if (!hashesMatch(expectedSourceSha256, actualSourceSha256)) {
    throw new DeploymentGateError('worker_source_sha256_mismatch');
  }
  return { source, actualSourceSha256 };
}

export async function prepareDeployment({
  env = process.env,
  argv = [],
  readFile = readFileFromDisk,
} = {}) {
  const configuration = localConfiguration(env, argv);
  const { source, actualSourceSha256 } = await readAndVerifySource({
    sourcePath: DEFAULT_SOURCE_PATH,
    readFile,
    expectedSourceSha256: configuration.expectedSourceSha256,
  });
  const multipart = buildVersionMultipart(source, configuration.compatibilityDate);

  return { ...configuration, source, actualSourceSha256, multipart };
}

async function cloudflareJSON(fetchImpl, url, init, failureCode) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new DeploymentGateError(failureCode);
  }
  if (!response || response.ok !== true) throw new DeploymentGateError(failureCode);

  try {
    const payload = await response.json();
    if (!payload || payload.success !== true) throw new Error('unsuccessful');
    return payload;
  } catch {
    throw new DeploymentGateError(failureCode);
  }
}

function versionIdFrom(payload) {
  const versionId = payload?.result?.id;
  if (typeof versionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    throw new DeploymentGateError('version_upload_response_invalid');
  }
  return versionId;
}

/**
 * Validates every local gate before making either permitted Cloudflare request.
 * `fetchImpl` is injected for tests; production uses Node's global fetch.
 */
export async function runDeployment(options = {}) {
  const prepared = await prepareDeployment(options);
  if (prepared.dryRun) {
    return { dryRun: true, sourceSha256: prepared.actualSourceSha256 };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new DeploymentGateError('fetch_unavailable');
  const headers = { authorization: `Bearer ${prepared.apiToken}` };
  const settings = await cloudflareJSON(
    fetchImpl,
    settingsURL(prepared.accountId),
    { method: 'GET', headers, redirect: 'error' },
    'worker_settings_read_failed',
  );
  assertRemoteDisabledSettings(settings);
  const upload = await cloudflareJSON(
    fetchImpl,
    versionUploadURL(prepared.accountId),
    { method: 'POST', headers, body: prepared.multipart, redirect: 'error' },
    'version_upload_failed',
  );
  const versionId = versionIdFrom(upload);

  const deployment = await cloudflareJSON(
    fetchImpl,
    deploymentURL(prepared.accountId),
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        strategy: 'percentage',
        versions: [{ version_id: versionId, percentage: 100 }],
      }),
      redirect: 'error',
    },
    'deployment_request_failed',
  );

  return {
    dryRun: false,
    sourceSha256: prepared.actualSourceSha256,
    versionId,
    deploymentId: typeof deployment.result?.id === 'string' ? deployment.result.id : undefined,
  };
}

export async function main() {
  const result = await runDeployment({ argv: process.argv.slice(2) });
  if (result.dryRun) {
    console.info('Local validation passed; dry run made no network request.');
  } else {
    console.info('Disabled-mode version upload and 100% deployment request completed.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof DeploymentGateError ? error.code : 'unexpected_error';
    console.error(`Deployment blocked: ${message}`);
    process.exitCode = 1;
  });
}
