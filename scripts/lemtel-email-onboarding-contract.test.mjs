import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));

test('email-only onboarding contract is disabled until explicitly deployed', () => {
  const contract = json('infra/lemtel-self-hosted/email-onboarding-contract.json');
  assert.equal(contract.deployment.migration_apply_authorized, false);
  assert.equal(contract.deployment.edge_deployment_authorized, false);
  assert.equal(contract.deployment.email_delivery_authorized, false);
  assert.equal(contract.identity.login_identifier, 'email');
  assert.equal(contract.identity.no_extension_or_sip_domain_login, true);
  assert.match(contract.forbidden.join(' '), /Planipret_data_or_auth/);
  assert.match(contract.forbidden.join(' '), /FusionPBX_mutation/);
});

test('schema is Lemtel-only and never stores temporary passwords', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0003_lemtel_email_onboarding.sql');
  assert.match(sql, /lemtel_platform_administrators/);
  assert.match(sql, /lemtel_onboarding_delivery_attempts/);
  assert.match(sql, /Temporary passwords, Auth tokens, SMTP credentials and full email bodies are never stored here/i);
  assert.doesNotMatch(sql, /planipret/i);
  assert.doesNotMatch(sql, /\bpbx_[a-z_]+\b/i);
  assert.doesNotMatch(sql, /temporary_password\s+(text|varchar|jsonb)/i);
});

test('onboarding administrator function enforces role and email-only limits', () => {
  const source = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
  assert.match(source, /platformAdmin/);
  assert.match(source, /organizationAdmin/);
  assert.match(source, /lemtel_onboarding_required: true/);
  assert.match(source, /LEMTEL_DOWNLOAD_IOS_URL/);
  assert.match(source, /LEMTEL_DOWNLOAD_ANDROID_URL/);
  assert.match(source, /LEMTEL_DOWNLOAD_DESKTOP_URL/);
  assert.match(source, /email_provider_not_configured/);
  assert.doesNotMatch(source, /functions\.invoke\(['"]pbx|from\(['"]pbx_/i);
  assert.doesNotMatch(source, /console\.log/);
});

test('first-password completion uses authenticated auth state and strong passwords', () => {
  const source = read('infra/lemtel-self-hosted/functions/lemtel-complete-first-password/index.ts');
  assert.match(source, /admin\.auth\.getUser\(token\)/);
  assert.match(source, /lemtel_onboarding_required !== true/);
  assert.match(source, /validPermanentPassword/);
  assert.match(source, /updateUserById/);
  assert.doesNotMatch(source, /functions\.invoke\(['"]pbx|console\.log/i);
});

test('temporary-password recovery is Lemtel-only, generic and server-throttled', () => {
  const contract = json('infra/lemtel-self-hosted/email-onboarding-contract.json');
  const sql = read('infra/lemtel-self-hosted/migrations/0004_lemtel_temporary_password_recovery.sql');
  const source = read('infra/lemtel-self-hosted/functions/lemtel-password-reset-request/index.ts');
  const manifest = json('infra/lemtel-self-hosted/functions/lemtel-password-reset-request/manifest.json');
  assert.match(contract.identity.forgot_password, /generic_non_enumerating/);
  assert.match(contract.forbidden.join(' '), /password_recovery_account_enumeration/);
  assert.match(sql, /lemtel_password_reset_throttles/);
  assert.match(sql, /lemtel_claim_password_reset/);
  assert.match(sql, /lemtel_find_password_reset_recipient/);
  assert.doesNotMatch(sql, /planipret/i);
  assert.doesNotMatch(sql, /temporary_password\s+(text|varchar|jsonb)/i);
  assert.match(source, /status: "request_accepted"/);
  assert.match(source, /lemtel_claim_password_reset/);
  assert.match(source, /lemtel_onboarding_required: true/);
  assert.match(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /console\.log|console\.error|pbx_|fusionpbx/i);
  assert.equal(manifest.authentication, 'anonymous_request_generic_response');
  assert.match(manifest.forbidden.join(' '), /temporary_password_database_storage/);
});

test('Desktop and mobile use the Lemtel recovery endpoint instead of a reset-link flow', () => {
  const desktop = read('apps/ava-softphone-desktop/src/components/SetupWizard.tsx');
  const mobile = read('apps/ava-softphone-mobile/src/screens/AuthScreen.tsx');
  assert.match(desktop, /lemtel-password-reset-request/);
  assert.match(desktop, /Email me a temporary password/);
  assert.match(desktop, /Forgot password\?/);
  assert.doesNotMatch(desktop, /label="Extension"|label="SIP domain"|Portal URL|Powered by AVA|AVA Statistic/);
  assert.match(mobile, /lemtel-password-reset-request/);
  assert.match(mobile, /mot de passe temporaire/);
  assert.doesNotMatch(mobile, /\/auth\/v1\/recover/);
});

test('session bootstrap exposes no telephony secrets before provisioning', () => {
  const source = read('infra/lemtel-self-hosted/functions/lemtel-session-bootstrap/index.ts');
  const executable = source.replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /first_password_change_required/);
  assert.match(source, /organizationById/);
  assert.match(source, /from\("lemtel_organizations"\)/);
  assert.doesNotMatch(executable, /lemtel_organizations!inner/);
  assert.match(source, /telephony: \{ status: "not_provisioned" \}/);
  assert.doesNotMatch(executable, /sip_password|wss_url|\bturn\b|fusionpbx/i);
});

test('Desktop refreshes onboarding metadata and opens as a Desktop workspace', () => {
  const wizard = read('apps/ava-softphone-desktop/src/components/SetupWizard.tsx');
  const main = read('apps/ava-softphone-desktop/electron/main.ts');
  const index = read('apps/ava-softphone-desktop/index.html');
  assert.match(wizard, /supabase\.auth\.refreshSession\(\)/);
  assert.match(wizard, /lemtel-auth-workspace/);
  assert.match(main, /width: 1180/);
  assert.match(main, /minWidth: 840/);
  assert.match(index, /Lemtel · Secure Communications Workspace/);
  assert.doesNotMatch(index, /Powered by AVA/);
});

test('onboarding CI typechecks npm dependencies without a checked-in node_modules tree', () => {
  const workflow = read('.github/workflows/lemtel-email-only-onboarding.yml');
  assert.match(workflow, /deno check --node-modules-dir=auto/);
});
