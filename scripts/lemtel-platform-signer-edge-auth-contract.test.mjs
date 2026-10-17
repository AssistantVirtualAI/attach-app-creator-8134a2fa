import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/edge-auth-contract.json');
const threatModelPath = resolve(root, 'docs/lemtel-ha/PLATFORM_SIGNER_EDGE_AUTH_THREAT_MODEL.md');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));

const isBlocked = (value) =>
  value.contract_version === 'lemtel_platform_signer_edge_auth_v1' &&
  value.scope === 'source_only_blocked' &&
  value.purpose === 'node_enrollment_publication_delivery_only' &&
  value.caller.logical_identity === 'do_edge_runtime' &&
  value.caller.authenticated_channel_configured === false &&
  value.caller.credential_source === 'unconfigured' &&
  value.caller.credential_persisted_in_repo === false &&
  value.caller.credential_passed_on_cli === false &&
  value.caller.credential_logged === false &&
  value.caller.source_ip_is_not_authentication === true &&
  value.cloudflare_access.hostname_protected_default_deny === true &&
  value.cloudflare_access.service_token_created === false &&
  value.cloudflare_access.service_auth_policy_configured === false &&
  value.cloudflare_access.user_identity_policy_configured === false &&
  value.cloudflare_access.browser_access_configured === false &&
  Object.values(value.request_protocol).every((entry) => entry === false) &&
  value.invariants.existing_platform_and_node_keys_reused_for_edge_auth === false &&
  value.invariants.signer_is_not_generic_oracle === true &&
  Object.entries(value.invariants)
    .filter(([key]) => key !== 'signer_is_not_generic_oracle')
    .every(([, entry]) => entry === false);

test('Edge-to-signer authentication remains source-only and blocked', () => {
  assert.ok(isBlocked(contract()));
});

test('edge authentication contract rejects premature credentials, signing, and HA actions', () => {
  const mutations = [
    (value) => { value.caller.authenticated_channel_configured = true; },
    (value) => { value.caller.credential_source = 'filesystem'; },
    (value) => { value.cloudflare_access.service_token_created = true; },
    (value) => { value.cloudflare_access.service_auth_policy_configured = true; },
    (value) => { value.request_protocol.canonical_request_configured = true; },
    (value) => { value.request_protocol.private_signing_key_worker_binding_configured = true; },
    (value) => { value.invariants.existing_platform_and_node_keys_reused_for_edge_auth = true; },
    (value) => { value.invariants.automatic_failover = true; },
  ];
  for (const mutate of mutations) {
    const value = contract();
    mutate(value);
    assert.equal(isBlocked(value), false);
  }
});

test('threat model rejects secret files, IP-only auth, generic signing, and HA coupling', () => {
  const text = readFileSync(threatModelPath, 'utf8');
  for (const phrase of [
    'source-only, bloqué',
    'Une IP source, seule, n’est jamais une authentification',
    'signer ne connaît aucune API fournisseur',
    'ne peut donc pas encore remplir ce rôle',
    'ne déverrouille pas le fencing',
  ]) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY|CF-Access-Client-Secret\s*[:=]\s*\S+)/u);
});
