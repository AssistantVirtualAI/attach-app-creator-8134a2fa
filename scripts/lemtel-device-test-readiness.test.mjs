import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateDeviceTestReadiness } from './lemtel-device-test-readiness.mjs';

const contract = JSON.parse(fs.readFileSync('infra/lemtel-client-cutover/device-test-readiness-contract.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/lemtel-hostinger-device-test-readiness.yml', 'utf8');

test('device readiness contract is Hostinger-only and fails closed before distribution', () => {
  assert.deepEqual(validateDeviceTestReadiness(contract), { ok: true, profile: 'hostinger-staging', purpose: 'private_device_test_only' });
  assert.equal(validateDeviceTestReadiness({ ...contract, profile: 'production' }).ok, false);
  assert.equal(validateDeviceTestReadiness({ ...contract, android: { ...contract.android, release_signing: true } }).ok, false);
  assert.equal(validateDeviceTestReadiness({ ...contract, desktop_macos: { ...contract.desktop_macos, auto_update: true } }).ok, false);
});

test('device workflow only builds private test material', () => {
  for (const expected of ['lemtel-device-test-readiness.mjs', 'assembleDebug', 'CODE_SIGNING_ALLOWED=NO', "CSC_IDENTITY_AUTO_DISCOVERY: 'false'", 'electron-builder --mac --x64 --arm64 --publish never', 'reactivecircus/android-emulator-runner@v2', 'retention-days: 3']) assert.match(workflow, new RegExp(expected));
  const emailOnlyProfile = 'VITE_LEMTEL_EMAIL_ONLY_SIGNIN: ${{ vars.VITE_LEMTEL_EMAIL_ONLY_SIGNIN }}';
  assert.equal(workflow.split(emailOnlyProfile).length - 1, 3, 'every private device build must receive the e-mail-only flag');
  for (const forbidden of ['bundleRelease', 'electron-updater', 'app-store', 'play.google', 'docker compose up', 'ufw allow', 'Planipret', 'lemtel/lovable-sync']) assert.doesNotMatch(workflow, new RegExp(forbidden, 'i'));
});
