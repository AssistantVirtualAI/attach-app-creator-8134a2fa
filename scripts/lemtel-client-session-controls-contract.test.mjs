import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read('infra/lemtel-self-hosted/migrations/0014_lemtel_client_session_controls.sql');
const bootstrap = read('infra/lemtel-self-hosted/functions/lemtel-session-bootstrap/index.ts');
const admin = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
const api = read('src/pages/lemtel/onboarding/lemtelHostedApi.ts');
const portal = read('src/pages/lemtel/onboarding/LemtelPortalApp.tsx');
const documentation = read('docs/lemtel-portal/CLIENT_SESSION_CONTROLS.md');
const executable = (value) => value.replace(/^\s*\/\/.*$/gmu, '');
const prohibited = /(?:planipret|avastatistic|fusionpbx|pbx_|\bsip:\/\/|\bwss:\/\/|\bturn:\/\/|pg_promote|nsupdate)/imu;

test('session control schema is server-only, privacy-minimal and bootstrap-bound', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.lemtel_client_session_controls/);
  assert.match(migration, /client_kind IN \('mobile', 'desktop', 'client'\)/);
  assert.match(migration, /access_state IN \('active', 'revoked'\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.lemtel_client_session_controls FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /lemtel_session_bootstrap_context_for_client/);
  assert.match(migration, /COALESCE\(control\.access_state, 'active'\) = 'active'/);
  assert.match(migration, /lemtel_record_authorized_client_connection/);
  assert.match(migration, /client_session_access_revoked/);
  assert.doesNotMatch(migration, prohibited);
});

test('both server paths bind the controls to the authoritative session gate', () => {
  assert.match(bootstrap, /lemtel_session_bootstrap_context_for_client/);
  assert.match(bootstrap, /lemtel_record_authorized_client_connection/);
  assert.match(bootstrap, /lemtel_active_client_access_required/);
  assert.match(admin, /action: "set_client_session_access"/);
  assert.match(admin, /setClientSessionAccess/);
  assert.match(admin, /lemtel_client_session_controls/);
  assert.match(admin, /await bumpAccountAuthorityRevision/);
  assert.doesNotMatch(executable(bootstrap), prohibited);
  assert.doesNotMatch(executable(admin), prohibited);
});

test('portal action is exact, confirmed and never receives client secrets', () => {
  assert.match(api, /buildSetClientSessionAccessBody/);
  assert.match(api, /setClientSessionAccess/);
  assert.match(portal, /window\.confirm\(accessState === "revoked"/);
  assert.match(portal, /connection\.accessState/);
  assert.match(documentation, /ni identifiant d’appareil/);
  assert.match(documentation, /ne touche pas la téléphonie/);
});
