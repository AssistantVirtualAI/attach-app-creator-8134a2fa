import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));

test('portal account authority remains prepared but inactive', () => {
  const contract = json('infra/lemtel-self-hosted/portal-account-authority-contract.json');
  assert.equal(contract.deployment.migration_apply_authorized, false);
  assert.equal(contract.deployment.edge_deployment_authorized, false);
  assert.equal(contract.deployment.client_cutover_authorized, false);
  assert.equal(contract.deployment.public_auth_signup_disable_verified, false);
  assert.equal(contract.authority.enrollment, 'portal_admin_server_side_only');
  assert.equal(contract.authority.password, 'supabase_auth_hash_only_no_plaintext_replication');
});

test('account-authority schema contains only Lemtel-safe revision mechanics', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0007_lemtel_portal_account_authority.sql');
  assert.match(sql, /account_authority_revision/);
  assert.match(sql, /lemtel_membership_authority_revision_after_change/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lemtel_bump_account_authority_revision\(uuid\)\s+TO service_role/);
  assert.doesNotMatch(sql, /planipret|pbx_|fusionpbx|sip_password|temporary_password\s+(text|varchar|jsonb)/i);
});

test('portal and applications use server authority rather than client signup or a copied password', () => {
  const portal = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
  const bootstrap = read('infra/lemtel-self-hosted/functions/lemtel-session-bootstrap/index.ts');
  const sessionControls = read('infra/lemtel-self-hosted/migrations/0014_lemtel_client_session_controls.sql');
  const mobile = read('apps/ava-softphone-mobile/src/lib/lemtelAuthorityReconciliation.ts');
  const auth = read('apps/ava-softphone-mobile/src/screens/AuthScreen.tsx');
  const desktop = read('apps/ava-softphone-desktop/src/components/SetupWizard.tsx');
  assert.match(portal, /createUser\(/);
  assert.match(bootstrap, /lemtel_email_only_signin/);
  assert.match(bootstrap, /lemtel_session_bootstrap_context_for_client/);
  assert.match(sessionControls, /lemtel_organization_memberships/);
  assert.match(sessionControls, /COALESCE\(control\.access_state, 'active'\) = 'active'/);
  assert.match(mobile, /bootstrapLemtelMobileSession/);
  assert.doesNotMatch(auth, /auth\/v1\/signup|signUp\(/i);
  assert.doesNotMatch(desktop, /auth\/v1\/signup|signUp\(/i);
});

test('cross-device design documents the central password and access boundary', () => {
  const doc = read('docs/lemtel-portal-account-authority.md');
  assert.match(doc, /Supabase Auth/);
  assert.match(doc, /jamais copié ni stocké en clair/i);
  assert.match(doc, /bootstrap serveur/i);
  assert.doesNotMatch(doc, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
});
