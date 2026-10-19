// Lemtel FusionPBX connection: one portal authority, one provisioning contract, same connection on Mobile and Desktop.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('Mobile and Desktop share a byte-identical provisioning contract', () => {
  const desktop = read('apps/ava-softphone-desktop/src/lib/lemtelSoftphoneProvisioning.ts');
  const mobile = read('apps/ava-softphone-mobile/src/lib/lemtelSoftphoneProvisioning.ts');
  assert.equal(mobile, desktop, 'copy apps/ava-softphone-desktop/src/lib/lemtelSoftphoneProvisioning.ts to the mobile app');
  assert.match(desktop, /lemtel-softphone-provisioning/);
  assert.match(desktop, /'X-Lemtel-Client': client/);
  assert.doesNotMatch(desktop, /localStorage|Preferences|console\./, 'the contract module never stores or logs');
  assert.doesNotMatch(desktop, /wss:\/\/[a-z0-9]/i, 'no endpoint is hardcoded in the contract');
});

test('Mobile takes its SIP connection only from the portal (no legacy endpoint, no client write into FusionPBX)', () => {
  const creds = read('apps/ava-softphone-mobile/src/lib/creds.ts');
  const app = read('apps/ava-softphone-mobile/src/MobileApp.tsx');
  const ice = read('apps/ava-softphone-mobile/src/lib/sip/iceServers.ts');
  assert.match(creds, /fetchLemtelProvisioning\(SUPABASE_URL_DEF, SUPABASE_ANON_DEF, c\.accessToken, platform\)/);
  assert.doesNotMatch(creds, /functions\/v1\/softphone-credentials/);
  assert.doesNotMatch(app, /softphone-sync-password|force_local_to_pbx/);
  assert.match(ice, /if \(provisioned\) return provisioned\.servers;/);
  assert.doesNotMatch(read('apps/ava-softphone-mobile/src/lib/prefetch.ts'), /webphoneToken/);
});

test('Desktop on the Lemtel origin uses the same contract and only the portal endpoints', () => {
  const hook = read('apps/ava-softphone-desktop/src/hooks/useSoftphone.ts');
  const sip = read('apps/ava-softphone-desktop/src/lib/sip/jssipProvider.ts');
  const app = read('apps/ava-softphone-desktop/src/App.tsx');
  assert.match(hook, /export const LEMTEL_PROVISIONED_ORIGIN = SB_URL !== LEGACY_BACKEND_URL;/);
  assert.match(hook, /fetchLemtelProvisioning\(SB_URL, SB_KEY, token, 'desktop'\)/);
  assert.match(hook, /provisioned: true/);
  assert.match(sip, /const candidateUrls: string\[\] = cfg\.provisioned\s*\n\s*\? \(cfg\.wssUrls\?\.length \? cfg\.wssUrls : \[cfg\.wssUrl\]\)/);
  assert.match(sip, /pcConfig\.iceServers = cfg\.iceServers\?\.length \? cfg\.iceServers : DEFAULT_ICE_SERVERS;/);
  assert.match(sip, /register_expires: cfg\.registerExpires \?\? 300,/);
  assert.match(app, /useLemtelDesktopProvisioning\(creds\?\.accessToken \|\| null, bootstrap\.status === 'not_provisioned'\)/);
});

test('Server: secrets encrypted and write-only, RLS closed, delivery behind two gates', () => {
  const sql = read('infra/lemtel-self-hosted/migrations/0024_lemtel_pbx_connection.sql');
  for (const table of ['lemtel_pbx_connections', 'lemtel_pbx_connection_secrets', 'lemtel_pbx_extension_assignments', 'lemtel_pbx_connection_audit']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /ciphertext ~ '\^v\[0-9\]\+/);
  assert.doesNotMatch(sql, /sip_password text|api_key text|shared_secret text/);
  const provisioning = read('infra/lemtel-self-hosted/functions/lemtel-softphone-provisioning/index.ts');
  assert.match(provisioning, /env\("LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY"\) !== "enabled"/);
  assert.match(provisioning, /if \(row\.state !== "active"\)/);
  assert.match(provisioning, /lemtel_session_bootstrap_context_for_client/);
  const admin = read('infra/lemtel-self-hosted/functions/lemtel-pbx-connection-admin/index.ts');
  assert.doesNotMatch(admin, /respond\([^)]*(sipPassword|body\.value|password)\b[^)]*\)/, 'no secret in a response');
  assert.match(admin, /in\("role", \["owner", "admin"\]\)/);
});

test('Portal exposes the Connexion FusionPBX intake on the telephony overview', () => {
  const control = read('src/pages/lemtel/onboarding/LemtelTelephonyControl.tsx');
  const panel = read('src/pages/lemtel/onboarding/LemtelPbxConnection.tsx');
  assert.match(control, /<LemtelPbxConnection lang=\{lang\} organizationId=\{organizationId\} readonly=\{readonly\} \/>/);
  assert.match(panel, /type="password" autoComplete="off"/);
  assert.match(panel, /pbxApi\.validate\(organizationId\)/);
  assert.match(panel, /pbxApi\.setState\(organizationId, "active"\)/);
});
