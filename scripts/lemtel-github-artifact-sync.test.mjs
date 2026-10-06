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
  assert.equal(contract.artifact.same_sha256_on_hostinger_and_digitalocean, true);
  assert.equal(contract.hostinger.runtime_apply, false);
  assert.equal(contract.digitalocean.runtime_apply, false);
  assert.equal(contract.digitalocean.containers_started, false);
  assert.deepEqual(contract.forbidden.sort(), ['Planipret_source_branch','Lovable_current_project_source','runtime_deployment','standby_start','database_exposure','dns_failover','FusionPBX_mutation','client_distribution'].sort());
});

test('workflow uses restricted secrets without storing addresses or runtime commands', () => {
  for (const required of ['LEMTEL_HOSTINGER_DEPLOY_KEY', 'LEMTEL_HOSTINGER_HOST', 'LEMTEL_HOSTINGER_KNOWN_HOSTS', 'LEMTEL_DIGITALOCEAN_DEPLOY_KEY', 'LEMTEL_DIGITALOCEAN_HOST', 'LEMTEL_DIGITALOCEAN_KNOWN_HOSTS', 'sha256sum', 'lemteldeploy@', 'lemtelstandbydeploy@']) assert.match(workflow, new RegExp(required));
  for (const forbidden of ['docker compose up', 'docker start', 'ufw allow', 'Planipret', 'lemtel/lovable-sync']) assert.doesNotMatch(workflow, new RegExp(forbidden, 'i'));
});
