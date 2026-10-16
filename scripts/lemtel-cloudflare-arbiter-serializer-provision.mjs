#!/usr/bin/env node
/**
 * Source-only, fail-closed provisioner for the Lemtel arbiter serializer.
 *
 * The non-dry-run path uses the immediate Worker script PUT endpoint because
 * Durable Object migrations cannot be applied by a version upload. Every
 * target, credential, compatibility date, source digest, and execution intent
 * is supplied at runtime; no invocation is performed by this repository file.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile as readFileFromDisk } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_NAME = 'lemtel-failover-arbiter';
export const WORKER_SOURCE_RELATIVE_PATH =
  'infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs';
export const MAIN_MODULE_NAME = 'lemtel-failover-arbiter-worker.mjs';
export const SERIALIZER_CLASS_NAME = 'LemtelFailoverSerializer';
export const SERIALIZER_BINDING_NAME = 'ARBITER_SERIALIZER';
export const SERIALIZER_MIGRATION_TAG = 'lemtel-arbiter-serializer-v1';
export const SERIALIZER_MIGRATION_TAG_PATTERN = /^lemtel-arbiter-serializer-v[1-9]\d*$/u;

export const INTENT_ENV = 'LEMTEL_CF_SERIALIZER_PROVISION_INTENT';
export const INTENT_VALUE = 'LEMTEL_CF_PROVISION_ARBITER_SERIALIZER_V1';
export const API_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN';
export const ACCOUNT_ID_ENV = 'LEMTEL_CF_TARGET_ACCOUNT_ID';
export const WORKER_NAME_ENV = 'LEMTEL_CF_WORKER_NAME';
export const SOURCE_SHA256_ENV = 'LEMTEL_CF_EXPECTED_SOURCE_SHA256';
export const COMPATIBILITY_DATE_ENV = 'LEMTEL_CF_COMPATIBILITY_DATE';
export const MIGRATION_TAG_ENV = 'LEMTEL_CF_SERIALIZER_MIGRATION_TAG';
export const DRY_RUN_ENV = 'LEMTEL_CF_DRY_RUN';

export const INHERITED_BINDINGS = Object.freeze([
  'STATE',
  'FAILOVER_MODE',
  'CONFIG_REVISION',
]);
export const LEGACY_ACK_BINDING_NAME = 'ARBITER_SERIALIZATION_ACK';
export const LEGACY_ACK_TEXT = 'reviewed_single_serialized_scheduler';
export const REMOTE_CURRENT_BINDINGS = Object.freeze([
  ...INHERITED_BINDINGS,
  LEGACY_ACK_BINDING_NAME,
]);

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_SOURCE_PATH = resolve(REPOSITORY_ROOT, WORKER_SOURCE_RELATIVE_PATH);

export class ProvisioningGateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProvisioningGateError';
    this.code = code;
  }
}

function requireExact(value, expected, code) {
  if (value !== expected) throw new ProvisioningGateError(code);
  return value;
}

function requireNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProvisioningGateError(code);
  }
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
    throw new ProvisioningGateError('expected_source_sha256_must_be_lowercase_hex');
  }
  return value;
}

function requireMigrationTag(value) {
  if (typeof value !== 'string' || !SERIALIZER_MIGRATION_TAG_PATTERN.test(value)) {
    throw new ProvisioningGateError('serializer_migration_tag_invalid');
  }
  return requireExact(value, SERIALIZER_MIGRATION_TAG, 'serializer_migration_tag_not_allowlisted');
}

function hashesMatch(expected, actual) {
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function normaliseSource(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new ProvisioningGateError('worker_source_must_be_bytes');
}

function localConfiguration(env, argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new ProvisioningGateError('cli_arguments_are_not_allowed');
  }

  requireExact(env[INTENT_ENV], INTENT_VALUE, 'provision_intent_not_confirmed');
  requireExact(env.FAILOVER_MODE, 'disabled', 'failover_mode_must_be_disabled');
  requireExact(env[WORKER_NAME_ENV], WORKER_NAME, 'worker_name_not_allowed');

  const accountId = requireNonEmptyString(env[ACCOUNT_ID_ENV], 'target_account_id_required');
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new ProvisioningGateError('target_account_id_must_be_lowercase_hex');
  }

  const compatibilityDate = requireNonEmptyString(
    env[COMPATIBILITY_DATE_ENV],
    'compatibility_date_required',
  );
  if (!isCalendarDate(compatibilityDate)) {
    throw new ProvisioningGateError('compatibility_date_must_be_calendar_date');
  }

  const expectedSourceSha256 = requireSourceHash(env[SOURCE_SHA256_ENV]);
  const migrationTag = requireMigrationTag(env[MIGRATION_TAG_ENV]);
  const dryRunValue = env[DRY_RUN_ENV];
  if (dryRunValue !== undefined && dryRunValue !== 'true') {
    throw new ProvisioningGateError('dry_run_must_be_true_when_set');
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
    migrationTag,
    dryRun,
  };
}

export function buildProvisioningMetadata(compatibilityDate, migrationTag) {
  if (!isCalendarDate(compatibilityDate)) {
    throw new ProvisioningGateError('compatibility_date_must_be_calendar_date');
  }
  requireMigrationTag(migrationTag);

  return {
    main_module: MAIN_MODULE_NAME,
    compatibility_date: compatibilityDate,
    bindings: [
      ...INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })),
      {
        name: SERIALIZER_BINDING_NAME,
        type: 'durable_object_namespace',
        class_name: SERIALIZER_CLASS_NAME,
      },
    ],
    migrations: {
      tag: migrationTag,
      new_sqlite_classes: [SERIALIZER_CLASS_NAME],
    },
  };
}

export function buildProvisioningMultipart(source, compatibilityDate, migrationTag) {
  const sourceBytes = normaliseSource(source);
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(buildProvisioningMetadata(compatibilityDate, migrationTag))], {
      type: 'application/json',
    }),
    'metadata.json',
  );
  form.append(
    MAIN_MODULE_NAME,
    new Blob([sourceBytes], { type: 'application/javascript+module' }),
    MAIN_MODULE_NAME,
  );
  return form;
}

function settingsURL(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/settings`;
}

function immediateScriptPUTURL(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}?bindings_inherit=strict`;
}

function isRevision(value) {
  return typeof value === 'string' && /^[a-z0-9-]{8,80}$/.test(value);
}

/**
 * The remote preflight only accepts the exact legacy binding surface currently
 * installed. It makes no changes: any missing, added, duplicate, renamed, or
 * type/value-mismatched binding blocks the subsequent immediate PUT.
 */
export function assertRemoteCurrentSettings(payload) {
  const bindings = payload?.result?.bindings;
  if (!Array.isArray(bindings)) {
    throw new ProvisioningGateError('worker_settings_response_invalid');
  }

  const byName = new Map();
  for (const binding of bindings) {
    if (!binding || typeof binding.name !== 'string' || byName.has(binding.name)) {
      throw new ProvisioningGateError('remote_bindings_not_exact');
    }
    byName.set(binding.name, binding);
  }

  if (byName.size !== REMOTE_CURRENT_BINDINGS.length ||
      !REMOTE_CURRENT_BINDINGS.every((name) => byName.has(name))) {
    throw new ProvisioningGateError('remote_bindings_not_exact');
  }

  const state = byName.get('STATE');
  const mode = byName.get('FAILOVER_MODE');
  const revision = byName.get('CONFIG_REVISION');
  const acknowledgement = byName.get(LEGACY_ACK_BINDING_NAME);
  if (!state || state.type !== 'kv_namespace' ||
      typeof state.namespace_id !== 'string' || !/^[a-f0-9]{32}$/.test(state.namespace_id) ||
      !revision || revision.type !== 'plain_text' || !isRevision(revision.text) ||
      !acknowledgement || acknowledgement.type !== 'plain_text' ||
      acknowledgement.text !== LEGACY_ACK_TEXT) {
    throw new ProvisioningGateError('remote_bindings_not_exact');
  }
  if (!mode || mode.type !== 'plain_text') {
    throw new ProvisioningGateError('remote_bindings_not_exact');
  }
  if (mode.text !== 'disabled') {
    throw new ProvisioningGateError('remote_failover_mode_not_disabled');
  }
}

async function readAndVerifySource({ sourcePath, readFile, expectedSourceSha256 }) {
  let source;
  try {
    source = normaliseSource(await readFile(sourcePath));
  } catch (error) {
    if (error instanceof ProvisioningGateError) throw error;
    throw new ProvisioningGateError('worker_source_unreadable');
  }

  const actualSourceSha256 = createHash('sha256').update(source).digest('hex');
  if (!hashesMatch(expectedSourceSha256, actualSourceSha256)) {
    throw new ProvisioningGateError('worker_source_sha256_mismatch');
  }
  return { source, actualSourceSha256 };
}

export async function prepareProvisioning({
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
  const multipart = buildProvisioningMultipart(
    source,
    configuration.compatibilityDate,
    configuration.migrationTag,
  );

  return { ...configuration, source, actualSourceSha256, multipart };
}

async function cloudflareJSON(fetchImpl, url, init, failureCode) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new ProvisioningGateError(failureCode);
  }
  if (!response || response.ok !== true) throw new ProvisioningGateError(failureCode);

  try {
    const payload = await response.json();
    if (!payload || payload.success !== true) throw new Error('unsuccessful');
    return payload;
  } catch {
    throw new ProvisioningGateError(failureCode);
  }
}

/**
 * Performs at most one settings GET and one immediate script PUT. The PUT is
 * intentionally not a version upload and there is no deployments handler:
 * Cloudflare applies Durable Object migrations only with an immediate deploy.
 */
export async function runProvisioning(options = {}) {
  const prepared = await prepareProvisioning(options);
  if (prepared.dryRun) {
    return { dryRun: true, sourceSha256: prepared.actualSourceSha256 };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new ProvisioningGateError('fetch_unavailable');
  const headers = { authorization: `Bearer ${prepared.apiToken}` };
  const settings = await cloudflareJSON(
    fetchImpl,
    settingsURL(prepared.accountId),
    { method: 'GET', headers, redirect: 'error' },
    'worker_settings_read_failed',
  );
  assertRemoteCurrentSettings(settings);

  await cloudflareJSON(
    fetchImpl,
    immediateScriptPUTURL(prepared.accountId),
    { method: 'PUT', headers, body: prepared.multipart, redirect: 'error' },
    'immediate_script_put_failed',
  );

  return { dryRun: false, sourceSha256: prepared.actualSourceSha256 };
}

export async function main(options = {}) {
  const {
    stdout = (message) => console.info(message),
    stderr = (message) => console.error(message),
    ...runOptions
  } = options;
  if (runOptions.argv === undefined) runOptions.argv = process.argv.slice(2);
  if (runOptions.env === undefined) runOptions.env = process.env;

  try {
    const result = await runProvisioning(runOptions);
    stdout(result.dryRun
      ? 'Local validation passed; dry run made no network request.'
      : 'Immediate disabled-mode Durable Object provisioning request completed.');
    return 0;
  } catch (error) {
    const code = error instanceof ProvisioningGateError ? error.code : 'unexpected_error';
    stderr(`Provisioning blocked: ${code}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
