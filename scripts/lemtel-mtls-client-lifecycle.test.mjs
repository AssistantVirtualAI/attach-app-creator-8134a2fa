import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { evaluateMtlsLifecycleTransition, MAXIMUM_LEAF_LIFETIME_SECONDS, MAXIMUM_ROTATION_OVERLAP_SECONDS, MTLS_CLIENT_LIFECYCLE, validateMtlsLifecycleRecord } from './lemtel-mtls-client-lifecycle.mjs';

const root = resolve(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/mtls-client-lifecycle-contract.json'), 'utf8'));
const deploymentContract = JSON.parse(readFileSync(resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/deployment-contract.json'), 'utf8'));
const relayContract = JSON.parse(readFileSync(resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/mtls-relay-contract.json'), 'utf8'));
const runbook = readFileSync(resolve(root, 'docs/lemtel-ha/MTLS_CLIENT_CERTIFICATE_LIFECYCLE.md'), 'utf8');
const now = 1_792_284_000;
const fingerprint = (value) => `sha256:${value.repeat(64)}`;
const record = (state, generation = 1, overrides = {}) => ({
  format: MTLS_CLIENT_LIFECYCLE.FORMAT,
  state,
  generation,
  commonName: MTLS_CLIENT_LIFECYCLE.COMMON_NAME,
  issuerFingerprint: fingerprint('a'),
  leafFingerprint: fingerprint(generation === 1 ? 'b' : 'c'),
  serial: generation === 1 ? '1'.repeat(32) : '2'.repeat(32),
  notBefore: now - 60,
  notAfter: now + 3600,
  overlapStartedAt: null,
  overlapUntil: null,
  reason: null,
  ...overrides,
});
const assertNeverActivates = (result) => {
  assert.equal(result.evidenceVerified, false);
  assert.equal(result.transitionAuthorized, false);
  assert.equal(result.relayActivationAllowed, false);
  assert.equal(result.accessPolicyActivationAllowed, false);
  assert.equal(result.automaticFailoverAllowed, false);
};

test('mTLS lifecycle contract is source-only, imported-CA aware, and remains non-activating', () => {
  assert.equal(contract.contract_version, 'lemtel_mtls_client_certificate_lifecycle_v1');
  assert.equal(contract.scope, 'source_only_evidence_state_machine');
  assert.equal(contract.status, 'not_ready_for_relay_activation');
  assert.equal(contract.identity.common_name_exact, MTLS_CLIENT_LIFECYCLE.COMMON_NAME);
  assert.equal(contract.identity.certificate_content_in_repository, false);
  assert.equal(contract.identity.private_key_in_repository, false);
  assert.equal(contract.bootstrap_ca_boundary.bootstrap_ca_private_key_destroyed, true);
  assert.equal(contract.bootstrap_ca_boundary.bootstrap_leaf_for_active_relay_forbidden, true);
  assert.equal(contract.durable_local_issuer_fallback.scope, 'source_only_before_cloudflare_import');
  assert.equal(contract.durable_local_issuer_fallback.external_hsm_equivalence_claimed, false);
  assert.equal(contract.durable_local_issuer_fallback.root_key_source, 'host_bound_root_only_encrypted_systemd_credential');
  assert.equal(contract.durable_local_issuer_fallback.root_private_key_in_repository, false);
  assert.equal(contract.durable_local_issuer_fallback.root_private_key_in_attestation, false);
  assert.equal(contract.durable_local_issuer_fallback.writer_rebuild_requires_new_ca_and_access_migration, true);
  assert.equal(contract.durable_local_issuer_fallback.rollback_cleanup_must_be_observable, true);
  assert.equal(contract.durable_local_issuer_fallback.host_credential_at_rest_protection_attested, false);
  assert.equal(contract.durable_local_issuer_fallback.canonical_at_rest_gate_id, 'root_only_credential_backend_with_encrypted_at_rest_attestation');
  assert.equal(contract.durable_local_issuer_fallback.cloudflare_access_imported, false);
  assert.equal(contract.durable_local_issuer_fallback.intermediate_per_leaf_required, true);
  assert.equal(contract.durable_local_issuer_fallback.leaf_issuance_or_relay_activation_authorized, false);
  assert.equal(contract.local_storage_observation.scope, 'root_only_read_only_redacted_observation');
  assert.equal(contract.local_storage_observation.credential_or_certificate_contents_read, false);
  assert.equal(contract.local_storage_observation.host_key_storage_protection, 'not_verified');
  assert.equal(contract.local_storage_observation.provider_storage_encryption, 'not_assessable_from_guest');
  assert.equal(contract.local_storage_observation.local_dm_crypt_observation_can_satisfy_at_rest_gate, false);
  assert.deepEqual(contract.local_storage_observation.cannot_satisfy_gate_ids, ['root_only_credential_backend_with_encrypted_at_rest_attestation']);
  assert.equal(contract.local_storage_observation.observation_can_authorize_relay, false);
  assert.equal(contract.local_storage_observation.observation_can_authorize_failover, false);
  assert.equal(contract.access_root_ca_attestation.imported_out_of_band, true);
  assert.equal(contract.access_root_ca_attestation.service_auth_policy_count, 0);
  assert.equal(contract.access_root_ca_attestation.der_fingerprint_reconciliation_complete, false);
  assert.equal(contract.metadata_shape.maximum_leaf_lifetime_seconds, MAXIMUM_LEAF_LIFETIME_SECONDS);
  assert.equal(contract.metadata_shape.maximum_rotation_overlap_seconds, MAXIMUM_ROTATION_OVERLAP_SECONDS);
  assert.ok(contract.metadata_shape.record_fields.includes('overlapStartedAt'));
  assert.equal(contract.state_machine.pure_structural_evaluator, true);
  assert.equal(contract.state_machine.persists_or_authenticates_history, false);
  assert.equal(contract.state_machine.missing_history_is_not_evidence_of_absence, true);
  assert.ok(Object.values(contract.activation).every((value) => value === false));
  for (const requirement of contract.canonical_gate_ids) {
    assert.ok(contract.required_before_any_relay_activation.includes(requirement), requirement);
    assert.ok(deploymentContract.required_before_signing.includes(requirement), requirement);
    assert.ok(relayContract.required_before_any_deployment.includes(requirement), requirement);
  }
  for (const expected of ['source-only', 'importée hors bande', 'ne permet pas d’activer', 'sans certificat', 'mauvais Common Name', 'révocation']) assert.ok(runbook.includes(expected), expected);
  assert.ok(contract.required_before_any_relay_activation.includes('root_only_credential_backend_with_encrypted_at_rest_attestation'));
});

test('lifecycle metadata rejects ambiguity, non-dedicated identity, excessive lifetime, and invalid terminal records', () => {
  assert.equal(validateMtlsLifecycleRecord(record('issued'), now), true);
  for (const changed of [
    { commonName: 'other-relay' },
    { issuerFingerprint: fingerprint('b') },
    { serial: 'A'.repeat(32) },
    { notAfter: now + MAXIMUM_LEAF_LIFETIME_SECONDS + 1 },
    { notBefore: now + 1 },
    { overlapUntil: now, reason: null },
    { unexpected: true },
  ]) assert.equal(validateMtlsLifecycleRecord(record('issued', 1, changed), now), false);
  assert.equal(validateMtlsLifecycleRecord(record('superseded', 1, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 60, overlapStartedAt: now - MAXIMUM_ROTATION_OVERLAP_SECONDS, overlapUntil: now, reason: 'rotation' }), now), true);
  assert.equal(validateMtlsLifecycleRecord(record('superseded', 1, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 60, overlapStartedAt: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 1, overlapUntil: now, reason: 'rotation' }), now), false);
  assert.equal(validateMtlsLifecycleRecord(record('revoked', 1, { reason: 'compromise' }), now), true);
  assert.equal(validateMtlsLifecycleRecord(record('revoked', 1, { reason: 'rotation' }), now), false);
  assert.equal(validateMtlsLifecycleRecord(record('expired', 1, { notAfter: now, reason: 'certificate_expired' }), now), true);
});

test('only structurally sound issuance, activation, rotation, revocation, and expiry reach external-evidence status', () => {
  const issued = record('issued');
  const active = record('active');
  const issue = evaluateMtlsLifecycleTransition({ next: issued, now });
  assert.deepEqual({ status: issue.status, transition: issue.transition, structurallyValid: issue.structurallyValid }, { status: 'external_evidence_required', transition: 'issue', structurallyValid: true });
  assertNeverActivates(issue);
  const activate = evaluateMtlsLifecycleTransition({ current: issued, next: active, now });
  assert.equal(activate.transition, 'activate'); assertNeverActivates(activate);
  const rotationActive = record('active', 1, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 60 });
  const successor = record('active', 2, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS, notAfter: now + 3500 });
  const superseded = record('superseded', 1, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 60, overlapStartedAt: now - MAXIMUM_ROTATION_OVERLAP_SECONDS, overlapUntil: now, reason: 'rotation' });
  const rotation = evaluateMtlsLifecycleTransition({ current: rotationActive, next: superseded, successor, now });
  assert.equal(rotation.transition, 'rotate'); assertNeverActivates(rotation);
  const revoked = record('revoked', 1, { reason: 'operator_revoke' });
  const revoke = evaluateMtlsLifecycleTransition({ current: active, next: revoked, now });
  assert.equal(revoke.transition, 'revoke'); assertNeverActivates(revoke);
  const expiring = record('active', 1, { notAfter: now });
  const expired = record('expired', 1, { notAfter: now, reason: 'certificate_expired' });
  const expire = evaluateMtlsLifecycleTransition({ current: expiring, next: expired, now });
  assert.equal(expire.transition, 'expire'); assertNeverActivates(expire);
});

test('rejection is fail-closed for malformed issuance, bad successor, and any reactivation of terminal state', () => {
  const issued = record('issued');
  const active = record('active');
  const superseded = record('superseded', 1, { notBefore: now - MAXIMUM_ROTATION_OVERLAP_SECONDS - 60, overlapStartedAt: now - MAXIMUM_ROTATION_OVERLAP_SECONDS, overlapUntil: now, reason: 'rotation' });
  for (const result of [
    evaluateMtlsLifecycleTransition({ next: record('active'), now }),
    evaluateMtlsLifecycleTransition({ current: issued, next: record('active', 2), now }),
    evaluateMtlsLifecycleTransition({ current: active, next: superseded, successor: record('active', 2, { issuerFingerprint: fingerprint('d') }), now }),
    evaluateMtlsLifecycleTransition({ current: record('revoked', 1, { reason: 'compromise' }), next: active, now }),
    evaluateMtlsLifecycleTransition({ current: record('expired', 1, { notAfter: now, reason: 'certificate_expired' }), next: active, now }),
  ]) {
    assert.equal(result.status, 'manual_review_required');
    assert.equal(result.structurallyValid, false);
    assertNeverActivates(result);
  }
});

test('lifecycle evaluator has no filesystem, network, child-process, provider, or activation surface', () => {
  const source = readFileSync(resolve(root, 'scripts/lemtel-mtls-client-lifecycle.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:node:(?:fs|http|https|net|tls|child_process)|fetch\s*\(|XMLHttpRequest|WebSocket|spawn\s*\(|exec(?:File)?\s*\(|process\.(?:env|argv|stdout|stderr|exit)|readFile|writeFile|mkdir|rmSync|curl|wget|ssh|cloudflare|fencing|promotion|dns|load.?balancer|telephony)\b/iu);
});
