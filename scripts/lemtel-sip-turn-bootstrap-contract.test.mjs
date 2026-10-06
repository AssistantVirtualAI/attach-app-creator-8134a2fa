import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContract } from './lemtel-sip-turn-bootstrap-contract.mjs';

test('contract denies implementation, client activation, PBX mutations and secrets', () => {
  assert.deepEqual(validateContract(), { ok: true, errors: [] });
});

test('any authorization lift fails closed', () => {
  const invalid = { scope: 'offline_contract_only', deployment_authorized: true, client_activation_authorized: false, fusionpbx_change_authorized: false, secrets_in_contract: false, issuers: [], forbidden_actions: [], required_external_evidence_before_implementation: [] };
  assert.equal(validateContract(invalid).ok, false);
});
