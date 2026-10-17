import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/active-passive/do-secrets-manager-wif-contract.json');
const runbookPath = resolve(root, 'docs/lemtel-ha/DIGITALOCEAN_SECRETS_MANAGER_WIF_RUNBOOK.md');
const contract = () => JSON.parse(readFileSync(contractPath, 'utf8'));

const isFailClosed = (value) =>
  value.secret_manager.container_created === false &&
  value.secret_manager.secret_value_created === false &&
  value.secret_manager.secret_value_read === false &&
  value.secret_manager.writer_long_lived_api_token_forbidden === true &&
  value.workload_identity.proxy_app_platform_provisioned === false &&
  value.workload_identity.oauth_application_provisioned === false &&
  value.workload_identity.writer_oidc_subject_present === false &&
  value.signer.private_key_provisioned === false &&
  value.signer.public_pin_distributed_out_of_band === false &&
  value.signer.enrollment_binding_enabled === false &&
  value.signer.signing_oracle_public === false &&
  Object.values(value.activation).every((entry) => entry === false) &&
  value.boundaries.do_writer_remains_unique === true &&
  value.boundaries.hostinger_runtime_remains_private_and_stopped === true &&
  value.boundaries.public_postgres_listener === false &&
  value.boundaries.cloudflare_or_dns_changed === false &&
  value.boundaries.planipret_change === false &&
  value.boundaries.avastatistic_change === false &&
  value.boundaries.pbx_or_telephony_change === false;

test('DigitalOcean Secrets Manager WIF is source-only and cannot activate HA', () => {
  const value = contract();
  assert.equal(value.contract_version, 'lemtel_do_secrets_manager_wif_v1');
  assert.equal(value.scope, 'source_only_external_secret_architecture');
  assert.equal(value.writer, 'do_writer');
  assert.equal(value.standby, 'hostinger_private_hot_standby');
  assert.equal(value.secret_manager.provider, 'digitalocean_secrets_manager');
  assert.equal(value.secret_manager.portal_secret_access, false);
  assert.equal(value.secret_manager.node_secret_access, false);
  assert.equal(value.workload_identity.model, 'digitalocean_oauth_workload_identity_proxy_poc');
  assert.equal(value.workload_identity.short_lived_token_only, true);
  assert.equal(value.workload_identity.least_privilege_single_signer_read, true);
  assert.ok(isFailClosed(value));
});

test('WIF contract rejects activation, secret exposure, and topology relaxation', () => {
  const mutations = [
    (value) => { value.secret_manager.secret_value_created = true; },
    (value) => { value.secret_manager.writer_long_lived_api_token_forbidden = false; },
    (value) => { value.workload_identity.proxy_app_platform_provisioned = true; },
    (value) => { value.signer.private_key_provisioned = true; },
    (value) => { value.signer.signing_oracle_public = true; },
    (value) => { value.activation.automatic_failover = true; },
    (value) => { value.activation.automatic_promotion = true; },
    (value) => { value.boundaries.cloudflare_or_dns_changed = true; },
    (value) => { value.boundaries.hostinger_runtime_remains_private_and_stopped = false; },
  ];
  for (const mutate of mutations) {
    const value = contract();
    mutate(value);
    assert.equal(isFailClosed(value), false);
  }
});

test('WIF runbook preserves secret and failover boundaries', () => {
  const runbook = readFileSync(runbookPath, 'utf8');
  const normalized = runbook.toLowerCase();
  for (const required of [
    '403',
    'jeton persistant sur le writer',
    'PoC OAuth/WIF',
    'aucun secret, coffre, proxy App Platform, OAuth App',
    'Aucun `FAILOVER_MODE=active`',
    'Aucun token API long-lived sur le writer ou le standby',
  ]) assert.ok(normalized.includes(required.toLowerCase()), required);
  assert.doesNotMatch(runbook, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
});
