import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ALLOWED_INHERITED_BINDINGS,
  API_TOKEN_ENV,
  COMPATIBILITY_DATE_ENV,
  INTENT_ENV,
  INTENT_VALUE,
  MAIN_MODULE_NAME,
  SOURCE_SHA256_ENV,
  WORKER_NAME,
  WORKER_NAME_ENV,
  buildVersionMultipart,
  runDeployment,
} from './lemtel-cloudflare-arbiter-disabled-version-deploy.mjs';

const SOURCE = Buffer.from('export default { fetch() { return new Response("disabled"); } };\n');
const SOURCE_SHA256 = createHash('sha256').update(SOURCE).digest('hex');
const ACCOUNT_ID = 'a'.repeat(32);
const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function environment(overrides = {}) {
  return {
    [INTENT_ENV]: INTENT_VALUE,
    FAILOVER_MODE: 'disabled',
    LEMTEL_CF_TARGET_ACCOUNT_ID: ACCOUNT_ID,
    [WORKER_NAME_ENV]: WORKER_NAME,
    [SOURCE_SHA256_ENV]: SOURCE_SHA256,
    [COMPATIBILITY_DATE_ENV]: '2025-02-03',
    [API_TOKEN_ENV]: 'test-runtime-credential',
    ...overrides,
  };
}

function sourceReader(value = SOURCE) {
  return async () => value;
}

function assertGate(code) {
  return (error) => error?.name === 'DeploymentGateError' && error.code === code;
}

function disabledRemoteSettings(overrides = {}) {
  return {
    bindings: [
      { name: 'STATE', type: 'kv_namespace' },
      { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
      { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
      { name: 'ARBITER_SERIALIZER', type: 'durable_object_namespace', class_name: 'LemtelFailoverSerializer' },
    ],
    ...overrides,
  };
}

test('multipart explicitly selects its module, date, and only strict inherited safe bindings', async () => {
  const form = buildVersionMultipart(SOURCE, '2025-02-03');
  const metadataPart = form.get('metadata');
  const metadata = JSON.parse(await metadataPart.text());
  const sourcePart = form.get(MAIN_MODULE_NAME);

  assert.equal(metadataPart.type, 'application/json');
  assert.equal(metadataPart.name, 'metadata.json');
  assert.deepEqual(metadata, {
    main_module: MAIN_MODULE_NAME,
    compatibility_date: '2025-02-03',
    bindings: ALLOWED_INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })),
  });
  assert.equal(sourcePart.name, MAIN_MODULE_NAME);
  assert.equal(sourcePart.type, 'application/javascript+module');
  assert.equal(await sourcePart.text(), SOURCE.toString());
});

test('dry run validates every local gate and makes no network request', async () => {
  let fetchCalls = 0;
  const result = await runDeployment({
    env: environment({ LEMTEL_CF_DRY_RUN: 'true', [API_TOKEN_ENV]: undefined }),
    readFile: sourceReader(),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
  });

  assert.deepEqual(result, { dryRun: true, sourceSha256: SOURCE_SHA256 });
  assert.equal(fetchCalls, 0);
});

test('gates reject invalid configuration before network access', async (t) => {
  const cases = [
    ['intent', environment({ [INTENT_ENV]: undefined }), [], 'deploy_intent_not_confirmed'],
    ['mode', environment({ FAILOVER_MODE: 'active' }), [], 'failover_mode_must_be_disabled'],
    ['arguments', environment(), ['--anything'], 'cli_arguments_are_not_allowed'],
    ['worker', environment({ [WORKER_NAME_ENV]: 'another-worker' }), [], 'worker_name_not_allowed'],
    ['account', environment({ LEMTEL_CF_TARGET_ACCOUNT_ID: 'not-an-account' }), [], 'target_account_id_must_be_lowercase_hex'],
    ['compatibility date', environment({ [COMPATIBILITY_DATE_ENV]: '2025-02-30' }), [], 'compatibility_date_must_be_calendar_date'],
    ['expected digest', environment({ [SOURCE_SHA256_ENV]: 'A'.repeat(64) }), [], 'expected_source_sha256_must_be_lowercase_hex'],
    ['runtime token', environment({ [API_TOKEN_ENV]: undefined }), [], 'api_token_required_at_runtime'],
    ['dry run', environment({ LEMTEL_CF_DRY_RUN: 'false' }), [], 'dry_run_must_be_true_when_set'],
  ];

  for (const [name, env, argv, code] of cases) {
    await t.test(name, async () => {
      let fetchCalls = 0;
      await assert.rejects(
        runDeployment({
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

test('source digest mismatch blocks before any Cloudflare request', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    runDeployment({
      env: environment({ [SOURCE_SHA256_ENV]: '0'.repeat(64) }),
      readFile: sourceReader(),
      fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
    }),
    assertGate('worker_source_sha256_mismatch'),
  );
  assert.equal(fetchCalls, 0);
});

test('live path reads disabled remote settings, uploads one version, then deploys only that version at 100 percent', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const result = requests.length === 1
      ? disabledRemoteSettings()
      : requests.length === 2
        ? { id: VERSION_ID }
        : { id: 'deployment-test-id' };
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await runDeployment({
    env: environment(),
    readFile: sourceReader(),
    fetchImpl,
  });

  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings`,
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(
    requests[1].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/versions?bindings_inherit=strict`,
  );
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[1].init.headers.authorization.startsWith('Bearer '), true);
  const uploadMetadata = JSON.parse(await requests[1].init.body.get('metadata').text());
  assert.deepEqual(uploadMetadata.bindings, ALLOWED_INHERITED_BINDINGS.map((name) => ({ name, type: 'inherit' })));
  assert.equal(uploadMetadata.main_module, MAIN_MODULE_NAME);
  assert.equal(uploadMetadata.compatibility_date, '2025-02-03');

  assert.equal(
    requests[2].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/deployments`,
  );
  assert.equal(requests[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    strategy: 'percentage',
    versions: [{ version_id: VERSION_ID, percentage: 100 }],
  });
  assert.deepEqual(result, {
    dryRun: false,
    sourceSha256: SOURCE_SHA256,
    versionId: VERSION_ID,
    deploymentId: 'deployment-test-id',
  });
});

test('remote active mode blocks before version upload', async () => {
  const requests = [];
  await assert.rejects(
    runDeployment({
      env: environment(),
      readFile: sourceReader(),
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({
          success: true,
          result: disabledRemoteSettings({
            bindings: [
              { name: 'STATE', type: 'kv_namespace' },
              { name: 'FAILOVER_MODE', type: 'plain_text', text: 'active' },
              { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
              { name: 'ARBITER_SERIALIZER', type: 'durable_object_namespace', class_name: 'LemtelFailoverSerializer' },
            ],
          }),
        }), { status: 200 });
      },
    }),
    assertGate('remote_failover_mode_not_disabled'),
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, 'GET');
});

for (const [label, serializer, code] of [
  ['historical text ACK instead of the Durable Object', { name: 'ARBITER_SERIALIZATION_ACK', type: 'plain_text', text: 'reviewed_single_serialized_scheduler' }, 'remote_bindings_not_allowlisted'],
  ['serializer bound to another class', { name: 'ARBITER_SERIALIZER', type: 'durable_object_namespace', class_name: 'OtherClass' }, 'remote_serializer_binding_invalid'],
  ['serializer of another type', { name: 'ARBITER_SERIALIZER', type: 'plain_text', text: 'x' }, 'remote_serializer_binding_invalid'],
  ['serializer hosted by another Worker', { name: 'ARBITER_SERIALIZER', type: 'durable_object_namespace', class_name: 'LemtelFailoverSerializer', script_name: 'other-worker' }, 'remote_serializer_binding_invalid'],
]) {
  test(`remote ${label} blocks before version upload`, async () => {
    const requests = [];
    await assert.rejects(runDeployment({ env: environment(), readFile: sourceReader(),
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ success: true, result: disabledRemoteSettings({ bindings: [
          { name: 'STATE', type: 'kv_namespace' },
          { name: 'FAILOVER_MODE', type: 'plain_text', text: 'disabled' },
          { name: 'CONFIG_REVISION', type: 'plain_text', text: 'lemtel-failover-v1' },
          serializer,
        ] }) }), { status: 200 });
      } }), assertGate(code));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.method, 'GET');
  });
}
