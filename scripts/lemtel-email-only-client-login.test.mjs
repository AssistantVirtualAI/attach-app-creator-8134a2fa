import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('mobile sign-in is email-only and blocks on first password replacement', () => {
  const source = read('apps/ava-softphone-mobile/src/screens/AuthScreen.tsx');
  assert.match(source, /lemtel-complete-first-password/);
  assert.match(source, /lemtel_organization_memberships/);
  assert.match(source, /lemtel_onboarding_required/);
  assert.doesNotMatch(source, /extension-signin/);
  assert.doesNotMatch(source, /ModeToggle/);
  assert.doesNotMatch(source, /Manual SIP configuration/);
});

test('desktop sign-in is email-only and fetches only Lemtel session bootstrap', () => {
  const source = read('apps/ava-softphone-desktop/src/components/SetupWizard.tsx');
  assert.match(source, /lemtel-complete-first-password/);
  assert.match(source, /lemtel-session-bootstrap/);
  assert.match(source, /lemtel_onboarding_required/);
  assert.match(source, /signInWithPassword\(\{[\s\S]*email: pending\.email,[\s\S]*password: newPassword/);
  assert.doesNotMatch(source, /auth\.refreshSession\(\)/);
  assert.doesNotMatch(source, /extension-signin/);
  assert.doesNotMatch(source, /pbx_softphone_users/);
  assert.doesNotMatch(source, /SIP Domain/);
});

test('mobile exchanges the temporary-password session for a new session', () => {
  const source = read('apps/ava-softphone-mobile/src/screens/AuthScreen.tsx');
  assert.match(source, /auth\/v1\/token\?grant_type=password/);
  assert.match(source, /email: pending\.email, password: newPassword/);
  assert.match(source, /onCompleted\(\{ accessToken: renewed\.access_token, refreshToken: renewed\.refresh_token \}\)/);
});

test('portal onboarding is isolated behind an explicit Lemtel build flag', () => {
  const route = read('src/pages/lemtel/LemtelCustomers.tsx');
  const panel = read('src/components/lemtel/LemtelHostedOnboardingPanel.tsx');
  assert.match(route, /VITE_LEMTEL_HOSTED_ONBOARDING === 'approved'/);
  assert.match(panel, /lemtel-onboarding-admin/);
  assert.match(panel, /Create and send welcome email/);
  assert.match(panel, /Provision users and send welcome emails/);
  assert.doesNotMatch(panel, /pbx-write|fusionpbx-proxy|mint-app-login-token/i);
});

test('Hostinger test builds require the email-only client profile', () => {
  const filter = read('scripts/lemtel-hostinger-client-config-filter.mjs');
  const workflow = read('.github/workflows/lemtel-hostinger-client-test-builds.yml');
  assert.match(filter, /EMAIL_ONLY_SIGNIN_FLAG_REQUIRED/);
  assert.match(workflow, /VITE_LEMTEL_EMAIL_ONLY_SIGNIN: approved/);
});
