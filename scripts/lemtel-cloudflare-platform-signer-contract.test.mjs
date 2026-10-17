import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/deployment-contract.json');
const workerPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-platform-signer-worker.mjs');
const runbookPath = resolve(root, 'docs/lemtel-ha/CLOUDFLARE_PLATFORM_SIGNER_BOOTSTRAP.md');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));

const isInert = (value) =>
  value.worker.workers_dev_enabled === false &&
  value.worker.public_route_configured === false &&
  value.worker.custom_domain_configured === false &&
  value.worker.scheduled_trigger_configured === false &&
  value.worker.durable_object_configured === false &&
  value.worker.kv_configured === false &&
  value.worker.observability_enabled === false &&
  value.worker.default_response_status === 404 &&
  value.secret_store.private_signing_key_write_only === true &&
  value.secret_store.worker_binding_created === false &&
  value.secret_store.worker_source_reads_key === false &&
  value.secret_store.private_key_output === false &&
  value.signing.request_authentication_configured === false &&
  value.signing.replay_ledger_configured === false &&
  value.signing.signing_endpoint_configured === false &&
  value.signing.node_enrollment_integration_configured === false &&
  value.signing.active === false &&
  Object.values(value.activation).every((entry) => entry === false) &&
  value.boundaries.do_writer_remains_unique === true &&
  value.boundaries.hostinger_runtime_remains_private_and_stopped === true &&
  Object.entries(value.boundaries)
    .filter(([name]) => name !== 'do_writer_remains_unique' && name !== 'hostinger_runtime_remains_private_and_stopped')
    .every(([, entry]) => entry === false);

test('Cloudflare platform signer bootstrap is externally stored and inert', () => {
  const value = contract();
  assert.equal(value.contract_version, 'lemtel_cloudflare_platform_signer_v1');
  assert.equal(value.scope, 'inert_external_signer_bootstrap');
  assert.equal(value.worker.logical_name, 'lemtel-platform-signer');
  assert.equal(value.secret_store.provider, 'cloudflare_secrets_store');
  assert.equal(value.secret_store.private_signing_key_generated_externally, true);
  assert.ok(isInert(value));
});

test('signer contract rejects public exposure, secret binding, signing, and HA activation', () => {
  const mutations = [
    (value) => { value.worker.workers_dev_enabled = true; },
    (value) => { value.worker.public_route_configured = true; },
    (value) => { value.worker.observability_enabled = true; },
    (value) => { value.secret_store.worker_binding_created = true; },
    (value) => { value.secret_store.worker_source_reads_key = true; },
    (value) => { value.signing.request_authentication_configured = true; },
    (value) => { value.signing.signing_endpoint_configured = true; },
    (value) => { value.signing.active = true; },
    (value) => { value.activation.automatic_failover = true; },
    (value) => { value.boundaries.worker_controls_provider_api = true; },
  ];
  for (const mutate of mutations) {
    const value = contract();
    mutate(value);
    assert.equal(isInert(value), false);
  }
});

test('inert worker is a no-store 404 sink without secrets, crypto, network, or logging', async () => {
  const source = readFileSync(workerPath, 'utf8');
  const worker = (await import(workerPath + `?test=${crypto.randomUUID()}`)).default;
  const response = await worker.fetch(new Request('https://signer.invalid/any/path', { method: 'POST' }), {});
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(source, /(?:env\.|crypto\.|fetch\s*\(\s*[^)]|console\.|WebSocket|DurableObject|KVNamespace|sign\s*\(|importKey|exportKey)/u);
});

test('runbook preserves the unbound and non-activating boundary', () => {
  const text = readFileSync(runbookPath, 'utf8');
  for (const required of [
    'signer inerte',
    'n’expose aucune URL',
    'n’attache pas encore cette clé à un Worker',
    'Une authentification indépendante Edge→Worker',
    'ne remplacerait jamais les gates L7',
  ]) assert.ok(text.includes(required), required);
  assert.doesNotMatch(text, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
});
