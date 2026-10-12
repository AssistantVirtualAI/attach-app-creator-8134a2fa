import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(
  new URL('../infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-passive-artifact-receiver-bootstrap.sh', import.meta.url),
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
