import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const edgeSource = readFileSync(resolve(repo, 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts'), 'utf8');
const catalogSource = readFileSync(resolve(repo, 'infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts'), 'utf8');
const uiSource = readFileSync(resolve(repo, 'src/pages/lemtel/onboarding/LemtelTelephonyControl.tsx'), 'utf8');
const docs = readFileSync(resolve(repo, 'docs/lemtel-portal/TELEPHONY_CONTROL_PLANE.md'), 'utf8');

const requiredKeys = [
  'extensions', 'pbx_users', 'devices', 'inbound_routes', 'time_conditions', 'ivr', 'ring_groups', 'gateways', 'voice_gateways', 'sip_profiles', 'dialplans', 'feature_codes', 'call_forwarding', 'voice_agents', 'agent_conversations', 'customers', 'pbx_settings',
  'queues', 'queue_agents', 'conferences', 'music_on_hold', 'recording_rules', 'voicemail_settings', 'wallboard', 'agent_console', 'call_center_admin', 'telephony_qa',
  'media_center', 'call_history', 'recordings', 'ai_insights', 'reports', 'sms', 'team_chat', 'active_calls', 'registrations', 'system_status', 'sync_health', 'ai_audit', 'users_access', 'app_downloads', 'advanced_pbx', 'workspace_settings',
];

test('telephony catalog covers the observed Avastatistic functional inventory without importing it', () => {
  for (const key of requiredKeys) assert.equal(catalogSource.includes(`["${key}"`), true, key);
  assert.doesNotMatch(catalogSource, /avastatistic\.ca|planipret/i);
});

test('telephony readiness remains server-authoritative and fail-closed', () => {
  assert.match(edgeSource, /action: "get_telephony_readiness"/);
  assert.match(edgeSource, /portalOrganizationAdmin\(admin, actor, request\.organizationId\)/);
  assert.match(catalogSource, /status: "not_provisioned"/);
  assert.doesNotMatch(catalogSource, /\b(?:fetch\(|\.insert\(|\.update\(|\.delete\(|Deno\.env|SUPABASE)/);
});

test('portal labels every telephony capability as not provisioned and names the activation gates', () => {
  assert.match(uiSource, /getTelephonyReadiness/);
  assert.match(uiSource, /Not provisioned/);
  assert.match(uiSource, /Informations Kenny\/Phil et prévol requis/);
  assert.match(docs, /informations fournisseur approuvées par Kenny\/Phil/);
  assert.match(docs, /Aucune capacité ne peut évoluer vers une configuration active/);
});


test('telephony preparation stores only a server-owned review marker and never provisions telephony', () => {
  const schema = readFileSync(resolve(repo, 'infra/lemtel-self-hosted/migrations/0018_lemtel_telephony_preparation_governance.sql'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(repo, 'infra/lemtel-self-hosted/migrations/lemtel-telephony-preparation-manifest.json'), 'utf8'));
  const client = readFileSync(resolve(repo, 'src/pages/lemtel/onboarding/lemtelHostedApi.ts'), 'utf8');
  assert.match(schema, /lemtel_telephony_preparation_states/);
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /REVOKE ALL ON TABLE public\.lemtel_telephony_preparation_states FROM PUBLIC, anon, authenticated/);
  assert.match(schema, /state = 'review_ready'/);
  assert.match(schema, /lemtel_set_telephony_preparation_state/);
  assert.match(edgeSource, /set_telephony_preparation_state/);
  assert.match(edgeSource, /TELEPHONY_CAPABILITY_KEYS/);
  assert.match(edgeSource, /activeOrganization\(admin, request\.organizationId\)/);
  assert.match(client, /write: true/);
  assert.match(uiSource, /Mark review ready/);
  assert.match(uiSource, /does not change any provider/);
  assert.equal(manifest.activation_authorized, false);
  assert.ok(manifest.explicitly_excluded.includes('provider_pbx_sip_wss_turn_telephony_configuration_write'));
  assert.doesNotMatch(schema, /(?:Deno\.env|fetch\(|provider_|sip_password|wss:|turn:|telephone_number)/i);
});
