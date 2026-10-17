import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(
  new URL('../infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-passive-artifact-receiver-bootstrap.sh', import.meta.url),
  'utf8',
);
const remediation = fs.readFileSync(
  new URL('../infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-passive-artifact-receiver-isolation-remediate.sh', import.meta.url),
  'utf8',
);
const workflow = fs.readFileSync(
  new URL('../.github/workflows/lemtel-github-artifact-sync.yml', import.meta.url),
  'utf8',
);

test('Hostinger artifact receiver is restricted to checksum-verified passive storage', () => {
  for (const required of [
    'bootstrap_hostinger_passive_artifact_receiver',
    'hostinger_standby_role_required',
    "receiver_user='lemtelstorage'",
    'restrict,command=',
    'SSH_ORIGINAL_COMMAND',
    "'receive '*)",
    'checksum_mismatch',
    'github-artifacts',
    'artifact_runtime_applied=false',
    'runtime_changed=false',
    'dns_changed=false',
    'postgres_promoted=false',
  ]) assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const forbidden of ['docker ', 'docker\n', 'docker-compose', 'systemctl start', 'systemctl restart', 'ufw allow', 'cloudflare', 'fusionpbx', 'sip']) {
    assert.doesNotMatch(script, new RegExp(forbidden, 'i'));
  }
});

test('immutable delivery targets the existing restricted Hostinger account', () => {
  assert.match(workflow, /lemtelstorage@\$HOST/u);
  assert.doesNotMatch(workflow, /lemteldeploy@\$HOST/u);
});

test('receiver remediation separates GitHub artifacts from root-only runtime envelopes', () => {
  for (const required of [
    'remediate_hostinger_passive_artifact_receiver_isolation',
    'hostinger_standby_role_required',
    "receiver_user='lemtelstorage'",
    "legacy_envelope_directory='/var/lib/lemtel-ha/artifacts/hostinger-received'",
    'github-artifacts',
    'legacy_envelope_directory_ownership_invalid',
    'existing_receiver_program_unrecognized',
    'receiver_authorization_preserved=true',
    'legacy_runtime_envelope_directory_unchanged=true',
    'artifact_runtime_applied=false',
    'automatic_failover_enabled=false',
  ]) assert.match(remediation, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const forbidden of ['docker ', 'docker\n', 'docker-compose', 'systemctl', 'ufw', 'curl ', 'cloudflare', 'fusionpbx', 'sip', 'chown .*legacy_envelope_directory', 'chmod .*legacy_envelope_directory']) {
    assert.doesNotMatch(remediation, new RegExp(forbidden, 'i'));
  }
});
