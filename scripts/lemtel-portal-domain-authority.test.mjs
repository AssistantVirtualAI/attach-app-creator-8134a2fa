import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('organization domains remain Lemtel-owned and require the authoritative edge function', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0008_lemtel_organization_domains.sql');
  const source = read('infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts');
  const client = read('src/pages/lemtel/onboarding/lemtelHostedApi.ts');
  const executable = source.replace(/^\s*\/\/.*$/gm, '');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.lemtel_organization_domains/);
  assert.match(sql, /REVOKE ALL ON public\.lemtel_organization_domains FROM anon, authenticated/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /planipret|pbx_|fusionpbx|sip_password/i);

  assert.match(source, /list_domains/);
  assert.match(source, /create_domain/);
  assert.match(source, /suspend_domain/);
  assert.match(source, /organizationAdmin\(admin, actor, request\.organizationId\)/);
  assert.doesNotMatch(executable, /functions\.invoke\(['"]pbx|from\(['"]pbx_|fusionpbx|sip_password/i);

  assert.match(client, /listDomains/);
  assert.match(client, /createDomain/);
  assert.match(client, /suspendDomain/);
  assert.doesNotMatch(client, /VITE_SUPABASE_URL/);
});

test('domain migration preserves legacy Lemtel audit actions while adding domain actions', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0008_lemtel_organization_domains.sql');
  for (const action of [
    'organization_created',
    'user_provisioned',
    'welcome_sent',
    'welcome_failed',
    'welcome_resent',
    'first_password_changed',
    'temporary_password_rotated',
    'user_access_suspended',
    'domain_created',
    'domain_suspended',
    'domain_reactivated',
  ]) assert.match(sql, new RegExp(`'${action}'`));
});

test('portal UI keeps unprovisioned communications read-only and does not imply a PBX connection', () => {
  const portal = read('src/pages/lemtel/onboarding/LemtelPortalApp.tsx');
  assert.match(portal, /t\.communications/);
  assert.match(portal, /notProvisioned/);
  assert.doesNotMatch(portal, /FusionPBX|SIP password|Sync all passwords/i);
});
