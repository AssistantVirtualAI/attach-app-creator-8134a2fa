import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-portal-authority-deploy.sh', import.meta.url), 'utf8');

test('portal authority deployment is writer-gated, digest-verified and transactional for runtime files', () => {
  for (const expected of [
    'deploy_verified_portal_authority',
    'digitalocean_writer',
    'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED',
    'manifest.sha256',
    '0008_lemtel_organization_domains.sql',
    'lemtel_organization_domains',
    'lemtel-onboarding-admin/index.ts',
    'lemtelTelephonyReadiness.ts',
    'catalog_replaced',
    'portal_directory_missing',
    'rollback()',
    'portal_authority_deploy_status=complete',
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('portal route marker accepts surrounding whitespace but remains unique and isolated', () => {
  assert.match(source, /portal_marker_summary=/);
  assert.match(source, /candidate == marker/);
  assert.match(source, /'1:1'/);
  assert.doesNotMatch(source, /grep -Fxc/);
});

test('portal authority deployment never changes topology, DNS, provider or telephony', () => {
  for (const forbidden of [
    /cloudflare/i,
    /hostinger/i,
    /\b(?:doctl|hcloud)\b/i,
    /pg_promote/i,
    /\b(?:curl|wget|nc|ssh|scp|rsync)\b/i,
    /(?:sip|wss|turn|fusionpbx)/i,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /dns_change_executed=false/);
  assert.match(source, /standby_runtime_started=false/);
  assert.match(source, /telephony_contacted=false/);
});
