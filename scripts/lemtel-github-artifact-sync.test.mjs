import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const contract = JSON.parse(fs.readFileSync(new URL('../infra/lemtel-delivery/github-artifact-sync-contract.json', import.meta.url), 'utf8'));
const workflow = fs.readFileSync(new URL('../.github/workflows/lemtel-github-artifact-sync.yml', import.meta.url), 'utf8');

test('artifact synchronization remains Lemtel-only and runtime-free', () => {
  assert.equal(contract.scope, 'artifact_sync_only');
  assert.equal(contract.source_branch, 'lemtel/integration');
  assert.equal(contract.lovable_source_configured, false);
  assert.equal(contract.artifact.same_sha256_on_hostinger_and_digitalocean, false);
  assert.deepEqual(contract.artifact.source_subtrees, [
    'apps/ava-softphone-mobile', 'apps/ava-softphone-desktop',
    'src/pages/lemtel', 'src/pages/lemtel-uc', 'src/components/lemtel-uc',
    'infra/lemtel-self-hosted', 'infra/lemtel-client-config', 'infra/lemtel-resilience', 'infra/lemtel-delivery',
    'docs/lemtel-*', 'scripts/lemtel-*.mjs', '.github/workflows/lemtel-*.yml',
  ]);
  assert.equal(contract.hostinger.runtime_apply, false);
  assert.equal(contract.digitalocean.writer_artifact_stage, false);
  assert.equal(contract.digitalocean.outbound_pull_controller_configured, false);
  assert.equal(contract.digitalocean.inbound_github_ssh_allowed, false);
  assert.equal(contract.digitalocean.runtime_apply, false);
  assert.equal(contract.digitalocean.containers_started, false);
  assert.deepEqual(contract.forbidden.sort(), ['Planipret_source_branch','Lovable_current_project_source','runtime_deployment','standby_start','database_exposure','dns_failover','FusionPBX_mutation','client_distribution'].sort());
});

test('workflow uses restricted secrets without storing addresses or runtime commands', () => {
  for (const required of ['LEMTEL_HOSTINGER_DEPLOY_KEY', 'LEMTEL_HOSTINGER_HOST', 'LEMTEL_HOSTINGER_KNOWN_HOSTS', 'LEMTEL_DIGITALOCEAN_DEPLOY_KEY', 'LEMTEL_DIGITALOCEAN_HOST', 'LEMTEL_DIGITALOCEAN_KNOWN_HOSTS', 'sha256sum', 'lemtelstorage@', 'lemtelstandbydeploy@']) assert.match(workflow, new RegExp(required));
  assert.match(workflow, /case "\$code" in 200\|401\)/);
  assert.match(workflow, /Deposit same artifact on DigitalOcean standby receiver without applying it/);
  assert.match(workflow, /digitalocean-promoted-writer-boundary/);
  for (const forbidden of ['docker compose up', 'docker start', 'ufw allow', 'Planipret', 'lemtel/lovable-sync']) assert.doesNotMatch(workflow, new RegExp(forbidden, 'i'));
});

test('workflow synchronizes only approved Lemtel portal sources', () => {
  for (const required of [
    "'src/pages/lemtel/**'", "'src/pages/lemtel-uc/**'", "'src/components/lemtel-uc/**'",
    'src/pages/lemtel', 'src/pages/lemtel-uc', 'src/components/lemtel-uc',
    'lemtel_docs', 'lemtel_scripts', 'lemtel_workflows',
  ]) assert.ok(workflow.includes(required), `missing ${required}`);
  assert.doesNotMatch(workflow, /\n\s+scripts\s+\\/);
  assert.doesNotMatch(workflow, /\n\s+\.github\/workflows\s+\\/);
});
