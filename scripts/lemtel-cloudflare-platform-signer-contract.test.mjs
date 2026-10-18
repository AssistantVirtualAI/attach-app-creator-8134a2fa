import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/deployment-contract.json');
const workerPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-platform-signer-worker.mjs');
const runbookPath = resolve(root, 'docs/lemtel-ha/CLOUDFLARE_PLATFORM_SIGNER_BOOTSTRAP.md');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));
const base64url = (value) => Buffer.from(value).toString('base64url');
const bytes = (size, fill) => Buffer.alloc(size, fill).toString('base64url');
const sha256 = async (value) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

const unconfigured = (value) =>
  value.worker.workers_dev_enabled === false && value.worker.public_route_configured === false &&
  value.worker.custom_domain_configured === true && value.worker.custom_domain === 'signer.lemtel.assistantvirtualai.com' &&
  value.worker.preview_urls_enabled === false && value.worker.scheduled_trigger_configured === false &&
  value.worker.durable_object_configured === false && value.worker.kv_configured === false &&
  value.worker.observability_enabled === false && value.worker.compatibility_date_configured === false &&
  value.worker.default_response_status === 404 && value.worker.source_delivery_endpoint_implemented === true &&
  value.worker.source_requires_explicit_active_mode === true && value.worker.source_replay_ledger_implemented === true &&
  value.worker.source_semantic_enrollment_authorization_implemented === true &&
  value.access.provider === 'cloudflare_zero_trust_access' && value.access.application_configured === true &&
  value.access.hostname_protected === true && value.access.default_deny === true && value.access.policy_count === 0 &&
  value.access.app_launcher_visible === false && value.access.session_duration === '10m' &&
  value.access.service_token_created === false && value.access.service_auth_policy_configured === false &&
  value.access.source_access_jwt_issuer_audience_signature_verification_implemented === true &&
  value.access.source_mtls_cert_verified_fingerprint_subject_verification_implemented === true &&
  value.access.source_access_jwks_network_fetch_forbidden === true && value.access.access_jwks_binding_created === false &&
  value.secret_store.private_signing_key_write_only === true && value.secret_store.worker_binding_created === false &&
  value.secret_store.worker_source_can_read_key_only_after_access_authorization_and_replay_gate === true && value.secret_store.private_key_output === false &&
  value.signing.request_authentication_configured === false && value.signing.replay_ledger_configured === false &&
  value.signing.semantic_authorization_key_configured === false && value.signing.signing_endpoint_configured === false &&
  value.signing.node_enrollment_integration_configured === false && value.signing.source_only_endpoint_implemented === true &&
  value.signing.source_only_canonical_request_validation_implemented === true && value.signing.source_only_replay_ledger_implemented === true && value.signing.source_only_replay_ledger_corruption_fails_closed === true &&
  value.signing.source_only_authorization_claim_implemented === true && value.signing.source_only_key_binding_after_all_gates_implemented === true &&
  value.signing.active === false && Object.values(value.activation).every((entry) => entry === false) &&
  value.boundaries.do_writer_remains_unique === true && value.boundaries.hostinger_runtime_remains_private_and_stopped === true &&
  Object.entries(value.boundaries).filter(([name]) => name !== 'do_writer_remains_unique' && name !== 'hostinger_runtime_remains_private_and_stopped').every(([, entry]) => entry === false);

async function signedJwt({ pair, publicKey, claims, algorithm, kid }) {
  const encode = (value) => base64url(JSON.stringify(value));
  const header = encode({ alg: algorithm, kid, typ: 'JWT' });
  const payload = encode(claims);
  const signature = await crypto.subtle.sign(
    algorithm === 'RS256' ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  publicKey.kid = kid; publicKey.alg = algorithm; publicKey.use = 'sig';
  return { token: `${header}.${payload}.${base64url(signature)}`, publicKey };
}

function requestWithMtls(body, token, fingerprint, host = 'signer.lemtel.assistantvirtualai.com', client = {}) {
  const request = new Request(`https://${host}/v1/node-enrollment-delivery`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': token }, body,
  });
  Object.defineProperty(request, 'cf', { value: { tlsClientAuth: {
    certVerified: 'SUCCESS', certPresented: '1', certRevoked: '0', certFingerprintSHA256: fingerprint,
    certSubjectDNRFC2253: 'CN=lemtel-do-signer-mtls-relay', ...client,
  } } });
  return request;
}

function ledgerStorage(values, alarms, writes) {
  return {
    transaction: async (callback) => callback({
      get: async (key) => values.get(key),
      put: async (key, value) => { writes.put++; values.set(key, value); },
      delete: async (key) => { writes.delete++; values.delete(key); },
      setAlarm: async (value) => { writes.alarm++; alarms.push(value); },
    }),
  };
}

test('Cloudflare platform signer remains Access-protected and operationally unconfigured', () => {
  const value = contract();
  assert.equal(value.contract_version, 'lemtel_cloudflare_platform_signer_v5');
  assert.equal(value.scope, 'access_protected_external_signer_source_only');
  assert.equal(value.worker.logical_name, 'lemtel-platform-signer');
  assert.equal(value.secret_store.provider, 'cloudflare_secrets_store');
  assert.equal(value.secret_store.private_signing_key_generated_externally, true);
  assert.ok(unconfigured(value));
  assert.equal(value.access.mtls_root_ca_imported_out_of_band, true);
  assert.equal(value.access.mtls_root_ca_associated_hostname, 'signer.lemtel.assistantvirtualai.com');
  assert.equal(value.access.mtls_root_ca_certificate_content_in_repository, false);
  assert.equal(value.access.mtls_root_ca_certificate_identifier_in_repository, false);
  assert.equal(value.access.mtls_root_ca_der_fingerprint_reconciled, true);
  assert.equal(value.access.mtls_root_ca_import_does_not_authorize_service_auth, true);
});

test('signer contract rejects provisioning, runtime signing and HA activation', () => {
  const mutations = [
    (value) => { value.worker.workers_dev_enabled = true; }, (value) => { value.worker.public_route_configured = true; },
    (value) => { value.worker.durable_object_configured = true; }, (value) => { value.access.default_deny = false; },
    (value) => { value.access.policy_count = 1; }, (value) => { value.access.access_jwks_binding_created = true; },
    (value) => { value.secret_store.worker_binding_created = true; }, (value) => { value.signing.replay_ledger_configured = true; },
    (value) => { value.signing.semantic_authorization_key_configured = true; }, (value) => { value.signing.active = true; },
    (value) => { value.activation.automatic_failover = true; }, (value) => { value.boundaries.worker_controls_provider_api = true; },
  ];
  for (const mutate of mutations) { const value = contract(); mutate(value); assert.equal(unconfigured(value), false); }
});

test('unconfigured Worker is a no-store 404 sink without signer, ledger or outbound access', async () => {
  const source = readFileSync(workerPath, 'utf8');
  const module = await import(workerPath + `?sink=${crypto.randomUUID()}`);
  let reads = 0, claims = 0;
  const response = await module.createPlatformSigner()(new Request('https://other.invalid/v1/node-enrollment-delivery', { method: 'POST' }), {
    PLATFORM_SIGNING_PRIVATE_JWK: { get: async () => { reads++; return '{}'; } },
    REPLAY_LEDGER: { getByName: () => { claims++; return {}; } },
  });
  assert.equal(response.status, 404); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(reads, 0); assert.equal(claims, 0);
  assert.doesNotMatch(source, /(?:networkFetch|cdn-cgi\/access\/certs|XMLHttpRequest|WebSocket|\/v2\/droplets|load.?balancer|cloudflare.?dns|telephony|fencing|promotion)/iu);
});

test('active source requires verified Access JWT, mTLS identity, semantic authorization and one-time replay claim before signing', async () => {
  const module = await import(workerPath + `?flow=${crypto.randomUUID()}`);
  const now = 1_792_200_000, team = 'https://lemtel.cloudflareaccess.com', audience = 'b'.repeat(64), fingerprint = 'c'.repeat(64), accessKid = 'a'.repeat(64), authorizationKid = 'd'.repeat(64);
  const accessPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const accessPublic = await crypto.subtle.exportKey('jwk', accessPair.publicKey);
  const access = await signedJwt({ pair: accessPair, publicKey: accessPublic, algorithm: 'RS256', kid: accessKid, claims: { iss: team, aud: audience, exp: now + 300, iat: now, nbf: now } });
  const enrollmentPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const enrollmentPublic = await crypto.subtle.exportKey('jwk', enrollmentPair.publicKey);
  const platformPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const platformPrivate = await crypto.subtle.exportKey('jwk', platformPair.privateKey);
  const platformPublic = await crypto.subtle.exportKey('jwk', platformPair.publicKey);
  const requestId = '11111111-1111-4111-8111-111111111111', authorizationId = '22222222-2222-4222-8222-222222222222', recipientFingerprint = `sha256:${'e'.repeat(64)}`;
  const challenge = { requestId, role: 'do_writer', fingerprint: recipientFingerprint, purpose: 'claim', nonce: '1'.repeat(64), expiresAt: now + 120 };
  const sealed = { challenge, ephemeralKey: bytes(65, 2), iv: bytes(12, 3), ciphertext: bytes(32, 4) };
  const sealedDigest = await sha256(module.canonical(sealed));
  const authorization = await signedJwt({ pair: enrollmentPair, publicKey: enrollmentPublic, algorithm: 'ES256', kid: authorizationKid, claims: {
    iss: 'lemtel-node-enrollment-authority-v1', aud: 'lemtel-platform-signer-v1', purpose: 'node_enrollment_publication_delivery', jti: authorizationId,
    rid: requestId, fp: recipientFingerprint, role: 'do_writer', challenge: sealed.challenge, sealedDigest, exp: now + 90, iat: now, nbf: now,
  } });
  const payload = module.canonical({ purpose: 'node_enrollment_publication_delivery', requestId, role: 'do_writer', recipientFingerprint, sealed, authorization: authorization.token });
  let ledgerCalls = 0, keyReads = 0, claimed = false;
  const env = {
    SIGNER_MODE: 'active', ACCESS_TEAM_DOMAIN: team, ACCESS_POLICY_AUD: audience, MTLS_RELAY_COMMON_NAME: 'lemtel-do-signer-mtls-relay', MTLS_RELAY_CERT_SHA256: fingerprint,
    ACCESS_JWKS_JSON: JSON.stringify({ keys: [access.publicKey] }), ENROLLMENT_AUTHORIZATION_KEY_ID: authorizationKid, ENROLLMENT_AUTHORIZATION_PUBLIC_JWK: JSON.stringify(authorization.publicKey),
    PLATFORM_SIGNING_PRIVATE_JWK: { get: async () => { keyReads++; return JSON.stringify(platformPrivate); } },
    REPLAY_LEDGER: { getByName: (name) => ({ fetch: async (url, init) => { ledgerCalls++; assert.equal(name, requestId); assert.equal(url, 'https://lemtel-replay-ledger/claim'); const claim = JSON.parse(init.body); assert.equal(claim.expiresAt, now + 90); if (claimed) return new Response('', { status: 409 }); claimed = true; return new Response(null, { status: 204 }); } }) },
  };
  const signer = module.createPlatformSigner({ now: () => now });
  const response = await signer(requestWithMtls(payload, access.token, fingerprint), env);
  assert.equal(response.status, 200);
  const result = JSON.parse(await response.text());
  assert.deepEqual(result.sealed, sealed);
  const verifyKey = await crypto.subtle.importKey('jwk', platformPublic, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, Buffer.from(result.signature, 'base64url'), new TextEncoder().encode(`lemtel-node-enrollment-v1:delivery\n${module.canonical(result.sealed)}`)), true);
  assert.equal(ledgerCalls, 1); assert.equal(keyReads, 1);
  assert.equal((await signer(requestWithMtls(payload, access.token, fingerprint), env)).status, 409); assert.equal(keyReads, 1);
  const alternative = await signer(requestWithMtls(payload, access.token, fingerprint, 'other.invalid'), env);
  assert.equal(alternative.status, 404); assert.equal(ledgerCalls, 2); assert.equal(keyReads, 1);
});

test('Worker denies missing, invalid, revoked, wrong-subject, and wrong-fingerprint mTLS before ledger or signer-key access', async () => {
  const module = await import(workerPath + `?mtls-negative=${crypto.randomUUID()}`);
  const now = 1_792_200_000, team = 'https://lemtel.cloudflareaccess.com', audience = 'b'.repeat(64), fingerprint = 'c'.repeat(64), authorizationKid = 'd'.repeat(64);
  const requestId = '11111111-1111-4111-8111-111111111111', recipientFingerprint = `sha256:${'e'.repeat(64)}`;
  const sealed = { challenge: { requestId, role: 'do_writer', fingerprint: recipientFingerprint, purpose: 'claim', nonce: '1'.repeat(64), expiresAt: now + 120 }, ephemeralKey: bytes(65, 2), iv: bytes(12, 3), ciphertext: bytes(32, 4) };
  const payload = module.canonical({ purpose: 'node_enrollment_publication_delivery', requestId, role: 'do_writer', recipientFingerprint, sealed, authorization: 'A'.repeat(32) });
  let ledgerCalls = 0, keyReads = 0;
  const env = {
    SIGNER_MODE: 'active', ACCESS_TEAM_DOMAIN: team, ACCESS_POLICY_AUD: audience, MTLS_RELAY_COMMON_NAME: 'lemtel-do-signer-mtls-relay', MTLS_RELAY_CERT_SHA256: fingerprint,
    ACCESS_JWKS_JSON: JSON.stringify({ keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'a'.repeat(64), n: 'AA', e: 'AQAB' }] }),
    ENROLLMENT_AUTHORIZATION_KEY_ID: authorizationKid, ENROLLMENT_AUTHORIZATION_PUBLIC_JWK: JSON.stringify({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: authorizationKid, x: 'AA', y: 'AA' }),
    REPLAY_LEDGER: { getByName: () => { ledgerCalls++; throw new Error('ledger must not be accessed'); } },
    PLATFORM_SIGNING_PRIVATE_JWK: { get: async () => { keyReads++; throw new Error('signer key must not be read'); } },
  };
  const signer = module.createPlatformSigner({ now: () => now });
  const alternativeCommonName = await signer(requestWithMtls(payload, 'invalid', fingerprint), { ...env, MTLS_RELAY_COMMON_NAME: 'another-valid-relay' });
  assert.equal(alternativeCommonName.status, 503);
  const cases = [
    {},
    { certVerified: 'FAILED' },
    { certPresented: '0' },
    { certRevoked: '1' },
    { certSubjectDNRFC2253: 'CN=other-relay' },
    { certSubjectDNRFC2253: 'CN=lemtel-do-signer-mtls-relay,O=unexpected' },
    { certFingerprintSHA256: 'f'.repeat(64) },
  ];
  for (const client of cases) {
    const response = await signer(requestWithMtls(payload, 'invalid', fingerprint, 'signer.lemtel.assistantvirtualai.com', client), env);
    assert.equal(response.status, 409);
  }
  const noCertificate = new Request('https://signer.lemtel.assistantvirtualai.com/v1/node-enrollment-delivery', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': 'invalid' }, body: payload });
  Object.defineProperty(noCertificate, 'cf', { value: {} });
  assert.equal((await signer(noCertificate, env)).status, 409);
  assert.equal(ledgerCalls, 0);
  assert.equal(keyReads, 0);
});

test('Worker source retains guards for semantic authorization and access token expiry before signer-key access', async () => {
  const source = readFileSync(workerPath, 'utf8');
  for (const required of ['certVerified', 'certFingerprintSHA256', 'certSubjectDNRFC2253', 'ACCESS_JWKS_JSON', 'ENROLLMENT_AUTHORIZATION_PUBLIC_JWK', 'expectedRequest(request)', 'validStoredClaim', 'setAlarm']) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /(?:payload\.sub|payload\.type|networkFetch|cdn-cgi\/access\/certs)/u);
});

test('replay ledger retains a live claim through a stale alarm and deletes only a valid expired claim', async () => {
  const module = await import(workerPath + `?ledger=${crypto.randomUUID()}`);
  const values = new Map(), alarms = [], writes = { put: 0, delete: 0, alarm: 0 };
  const storage = ledgerStorage(values, alarms, writes);
  const ledger = new module.LemtelSignerReplayLedger({ storage }); const now = Math.floor(Date.now() / 1000);
  const value = { requestId: '33333333-3333-4333-8333-333333333333', digest: 'f'.repeat(64), expiresAt: now + 90 };
  const claim = () => new Request('https://lemtel-replay-ledger/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: module.canonical(value) });
  assert.equal((await ledger.fetch(claim())).status, 204); assert.equal((await ledger.fetch(claim())).status, 409);
  assert.equal(alarms[0], value.expiresAt * 1000); assert.deepEqual(values.get('claim'), value); assert.equal(values.size, 1);
  await ledger.alarm();
  assert.deepEqual(values.get('claim'), value); assert.equal(writes.delete, 0); assert.equal(alarms.at(-1), value.expiresAt * 1000);
  values.set('claim', { ...value, expiresAt: now - 1 });
  await ledger.alarm();
  assert.equal(values.size, 0); assert.equal(writes.delete, 1);
  assert.equal((await ledger.fetch(claim())).status, 204);
});

test('replay ledger preserves corrupt claims during both alarm and claim handling', async () => {
  const module = await import(workerPath + `?ledger-corruption=${crypto.randomUUID()}`);
  const now = Math.floor(Date.now() / 1000);
  const value = { requestId: '33333333-3333-4333-8333-333333333333', digest: 'f'.repeat(64), expiresAt: now + 90 };
  const claim = () => new Request('https://lemtel-replay-ledger/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: module.canonical(value) });
  for (const corrupt of [null, {}, { requestId: value.requestId, digest: value.digest }, { requestId: value.requestId, digest: value.digest, expiresAt: now + 90, unexpected: true }, { requestId: 'not-a-uuid', digest: value.digest, expiresAt: now + 90 }, { requestId: value.requestId, digest: 'wrong', expiresAt: now + 90 }, { requestId: value.requestId, digest: value.digest, expiresAt: Number.MAX_SAFE_INTEGER + 1 }]) {
    const values = new Map([['claim', corrupt]]), alarms = [], writes = { put: 0, delete: 0, alarm: 0 };
    const ledger = new module.LemtelSignerReplayLedger({ storage: ledgerStorage(values, alarms, writes) });
    await ledger.alarm();
    assert.strictEqual(values.get('claim'), corrupt);
    assert.deepEqual(writes, { put: 0, delete: 0, alarm: 0 });
    assert.equal((await ledger.fetch(claim())).status, 409);
    assert.strictEqual(values.get('claim'), corrupt);
    assert.deepEqual(writes, { put: 0, delete: 0, alarm: 0 });
  }
});

test('runbook preserves production default-deny and non-activation boundaries', () => {
  const text = readFileSync(runbookPath, 'utf8');
  for (const required of ['hostname dédié', 'default-deny', 'Aucun service token n’existe encore', 'policy Access `service_auth`', 'identité mTLS dédiée', 'ne remplacerait jamais les gates L7', 'aucune installation']) assert.ok(text.includes(required), required);
  assert.doesNotMatch(text, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
});
