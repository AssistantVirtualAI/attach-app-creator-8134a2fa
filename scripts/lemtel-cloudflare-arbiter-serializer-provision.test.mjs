import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  API_TOKEN_ENV,
  COMPATIBILITY_DATE_ENV,
  INHERITED_BINDINGS,
  INTENT_ENV,
  INTENT_VALUE,
  LEGACY_ACK_BINDING_NAME,
  MAIN_MODULE_NAME,
  MIGRATION_TAG_ENV,
  SERIALIZER_BINDING_NAME,
  SERIALIZER_CLASS_NAME,
  SERIALIZER_MIGRATION_TAG,
  SOURCE_SHA256_ENV,
  WORKER_NAME,
  WORKER_NAME_ENV,
  buildProvisioningMultipart,
  main,
  runProvisioning,
} from './lemtel-cloudflare-arbiter-serializer-provision.mjs';

const SOURCE = Buffer.from('export default { fetch() { return new Response("disabled"); } };\n');
const SOURCE_SHA256 = createHash('sha256').update(SOURCE).digest('hex');
const ACCOUNT_ID = 'a'.repeat(32);
const NAMESPACE_ID = 'b'.repeat(32);
const TEST_TOKEN = 'test-runtime-credential-never-log';

function environment(overrides = {}) {
  return {
    [INTENT_ENV]: INTENT_VALUE,
    FAILOVER_MODE: 'disabled',
    LEMTEL_CF_TARGET_ACCOUNT_ID: ACCOUNT_ID,
    [WORKER_NAME_ENV]: WORKER_NAME,
    [SOURCE_SHA256_ENV]: SOURCE_SHA256,
    [COMPATIBILITY_DATE_ENV]: '2025-02-03',
    [MIGRATION_TAG_ENV]: SERIALIZER_MIGRATION_TAG,
    [API_TOKEN_ENV]: TEST_TOKEN,
    ...overrides,
  };
}

function sourceReader(value = SOURCE) {
  return async () => value;
}

function assertGate(code) {
  return (error) => error?.name === 'ProvisioningGateError' && error.code === code;
}

function remoteCurrentSettings(overrides = {}) {
  return {
    bindings: [
      { name: 'STATE', type: 'kv_namespace', namespace_id: NAMESPACE_ID },
      { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
      { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
      { name: LEGACY_ACK_BINDING_NAME, type: 'plain_text', text: 'reviewed_single_serialized_scheduler' },
    ],
    ...overrides,
  };
}

function cloudflareSuccess(result) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('multipart has an explicit module and date, strict safe inheritance, a Durable Object binding, and the exact SQLite migration', async () => {
  const form = buildProvisioningMultipart(SOURCE, '2025-02-03', SERIALIZER_MIGRATION_TAG);
  const metadataPart = form.get('metadata');
  const metadata = JSON.parse(await metadataPart.text());
  const sourcePart = form.get(MAIN_MODULE_NAME);

  assert.equal(metadataPart.type, 'application/json');
  assert.equal(metadataPart.name, 'metadata.json');
  assert.deepEqual(metadata, {
    main_module: MAIN_MODULE_NAME,
    compatibility_date: '2025-02-03',
    bindings: [
      ...INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })),
      {
        name: SERIALIZER_BINDING_NAME,
        type: 'durable_object_namespace',
        class_name: SERIALIZER_CLASS_NAME,
      },
    ],
    migrations: {
      tag: 'lemtel-arbiter-serializer-v1',
      new_sqlite_classes: ['LemtelFailoverSerializer'],
    },
  });
  assert.equal(metadata.bindings.some(({ name }) => name === LEGACY_ACK_BINDING_NAME), false);
  assert.equal(sourcePart.name, MAIN_MODULE_NAME);
  assert.equal(sourcePart.type, 'application/javascript+module');
  assert.equal(await sourcePart.text(), SOURCE.toString());
});

test('dry run validates locally and never performs a network request', async () => {
  let fetchCalls = 0;
  const result = await runProvisioning({
    env: environment({ LEMTEL_CF_DRY_RUN: 'true', [API_TOKEN_ENV]: undefined }),
    readFile: sourceReader(),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
  });

  assert.deepEqual(result, { dryRun: true, sourceSha256: SOURCE_SHA256 });
  assert.equal(fetchCalls, 0);
});

test('all local gates block before network access', async (t) => {
  const cases = [
    ['intent', environment({ [INTENT_ENV]: undefined }), [], 'provision_intent_not_confirmed'],
    ['mode active', environment({ FAILOVER_MODE: 'active' }), [], 'failover_mode_must_be_disabled'],
    ['mode bootstrap', environment({ FAILOVER_MODE: 'bootstrap' }), [], 'failover_mode_must_be_disabled'],
    ['arguments', environment(), ['--anything'], 'cli_arguments_are_not_allowed'],
    ['worker', environment({ [WORKER_NAME_ENV]: 'another-worker' }), [], 'worker_name_not_allowed'],
    ['account', environment({ LEMTEL_CF_TARGET_ACCOUNT_ID: 'not-an-account' }), [], 'target_account_id_must_be_lowercase_hex'],
    ['compatibility date', environment({ [COMPATIBILITY_DATE_ENV]: '2025-02-30' }), [], 'compatibility_date_must_be_calendar_date'],
    ['expected digest', environment({ [SOURCE_SHA256_ENV]: 'A'.repeat(64) }), [], 'expected_source_sha256_must_be_lowercase_hex'],
    ['migration grammar', environment({ [MIGRATION_TAG_ENV]: 'unreviewed-migration-v1' }), [], 'serializer_migration_tag_invalid'],
    ['migration allowlist', environment({ [MIGRATION_TAG_ENV]: 'lemtel-arbiter-serializer-v2' }), [], 'serializer_migration_tag_not_allowlisted'],
    ['runtime token', environment({ [API_TOKEN_ENV]: undefined }), [], 'api_token_required_at_runtime'],
    ['dry run spelling', environment({ LEMTEL_CF_DRY_RUN: 'false' }), [], 'dry_run_must_be_true_when_set'],
  ];

  for (const [name, env, argv, code] of cases) {
    await t.test(name, async () => {
      let fetchCalls = 0;
      await assert.rejects(
        runProvisioning({
          env,
          argv,
          readFile: sourceReader(),
          fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
        }),
        assertGate(code),
      );
      assert.equal(fetchCalls, 0);
    });
  }
});

test('source hash mismatch blocks before settings preflight', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    runProvisioning({
      env: environment({ [SOURCE_SHA256_ENV]: '0'.repeat(64) }),
      readFile: sourceReader(),
      fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
    }),
    assertGate('worker_source_sha256_mismatch'),
  );
  assert.equal(fetchCalls, 0);
});

test('live path does one strict settings GET followed by one immediate multipart PUT, with no deployment handler', async () => {
  const requests = [];
  const result = await runProvisioning({
    env: environment(),
    readFile: sourceReader(),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return cloudflareSuccess(requests.length === 1 ? remoteCurrentSettings() : { id: WORKER_NAME });
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings`,
  );
  assert.deepEqual(requests[0].init, {
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    redirect: 'error',
  });
  assert.equal(
    requests[1].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}?bindings_inherit=strict`,
  );
  assert.equal(requests[1].init.method, 'PUT');
  assert.equal(requests[1].init.redirect, 'error');
  assert.deepEqual(requests[1].init.headers, { authorization: `Bearer ${TEST_TOKEN}` });
  assert.equal(Object.hasOwn(requests[1].init.headers, 'content-type'), false, 'runtime FormData supplies its boundary');
  const metadata = JSON.parse(await requests[1].init.body.get('metadata').text());
  assert.deepEqual(metadata.bindings, [
    ...INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })),
    { name: SERIALIZER_BINDING_NAME, type: 'durable_object_namespace', class_name: SERIALIZER_CLASS_NAME },
  ]);
  assert.deepEqual(metadata.migrations, {
    tag: SERIALIZER_MIGRATION_TAG,
    new_sqlite_classes: [SERIALIZER_CLASS_NAME],
  });
  assert.equal(metadata.bindings.some(({ name }) => name === LEGACY_ACK_BINDING_NAME), false);
  assert.equal(JSON.stringify(metadata).includes(TEST_TOKEN), false);
  assert.deepEqual(result, { dryRun: false, sourceSha256: SOURCE_SHA256 });
});

test('remote active, missing, or extraneous settings block before the immediate PUT', async (t) => {
  const cases = [
    ['active', remoteCurrentSettings({
      bindings: [
        { name: 'STATE', type: 'kv_namespace', namespace_id: NAMESPACE_ID },
        { name: 'FAILOVER_MODE', type: 'plain_text', text: 'active' },
        { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
        { name: LEGACY_ACK_BINDING_NAME, type: 'plain_text', text: 'reviewed_single_serialized_scheduler' },
      ],
    }), 'remote_failover_mode_not_disabled'],
    ['missing', remoteCurrentSettings({
      bindings: [
        { name: 'STATE', type: 'kv_namespace', namespace_id: NAMESPACE_ID },
        { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
        { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
      ],
    }), 'remote_bindings_not_exact'],
    ['extraneous', remoteCurrentSettings({
      bindings: [
        { name: 'STATE', type: 'kv_namespace', namespace_id: NAMESPACE_ID },
        { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
        { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
        { name: LEGACY_ACK_BINDING_NAME, type: 'plain_text', text: 'reviewed_single_serialized_scheduler' },
        { name: 'UNREVIEWED_BINDING', type: 'plain_text', text: 'no' },
      ],
    }), 'remote_bindings_not_exact'],
  ];

  for (const [name, settings, code] of cases) {
    await t.test(name, async () => {
      const requests = [];
      await assert.rejects(
        runProvisioning({
          env: environment(),
          readFile: sourceReader(),
          fetchImpl: async (url, init) => {
            requests.push({ url, init });
            return cloudflareSuccess(settings);
          },
        }),
        assertGate(code),
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.method, 'GET');
      assert.equal(requests[0].init.redirect, 'error');
    });
  }
});

test('CLI reporting never writes the runtime API token or unexpected error text', async () => {
  const output = [];
  let fetchCalls = 0;
  const exitCode = await main({
    env: environment({ [INTENT_ENV]: 'wrong-intent' }),
    argv: [],
    readFile: sourceReader(),
    fetchImpl: async () => { fetchCalls += 1; throw new Error(TEST_TOKEN); },
    stdout: (message) => output.push(`out:${message}`),
    stderr: (message) => output.push(`err:${message}`),
  });

  assert.equal(exitCode, 1);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(output, ['err:Provisioning blocked: provision_intent_not_confirmed']);
  assert.equal(output.join('\n').includes(TEST_TOKEN), false);
});
