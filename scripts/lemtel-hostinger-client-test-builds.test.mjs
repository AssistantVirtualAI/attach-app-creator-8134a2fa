import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contract = JSON.parse(fs.readFileSync('infra/lemtel-client-config/hostinger-private-test-build-contract.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/lemtel-hostinger-client-test-builds.yml', 'utf8');

test('private Hostinger test build contract rejects distribution', () => {
  assert.equal(contract.profile, 'hostinger-staging');
  assert.equal(contract.distribution, false);
  assert.equal(contract.release_signing, false);
  assert.equal(contract.app_store_upload, false);
  assert.equal(contract.runtime_apply, false);
  assert.equal(contract.digitalocean_cold_standby_start, false);
  assert.deepEqual(contract.clients.sort(), ['android_debug', 'desktop', 'ios_unsigned']);
});

test('workflow builds only test artifacts and sends the same bundle to both receivers', () => {
  for (const expected of ['workflow_dispatch', 'assembleDebug', 'CODE_SIGNING_ALLOWED=NO', 'npm run build', 'lemteldeploy@', 'lemtelstandbydeploy@', 'lemtel-hostinger-client-config-filter.mjs', 'retention-days: 3']) assert.match(workflow, new RegExp(expected));
  assert.match(workflow, /push:\n    branches: \[lemtel\/integration\]/);
  for (const forbidden of ['bundleRelease', 'electron-builder', 'app-store', 'docker compose up', 'ufw allow', 'Planipret']) assert.doesNotMatch(workflow, new RegExp(forbidden, 'i'));
});
