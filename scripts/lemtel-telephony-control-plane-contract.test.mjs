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
