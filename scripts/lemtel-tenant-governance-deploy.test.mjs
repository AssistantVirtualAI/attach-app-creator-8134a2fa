import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const deploy = read('infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-tenant-governance-deploy.sh');
const doc = read('docs/lemtel-portal/TENANT_GOVERNANCE_DEPLOYMENT.md');
const executable = deploy.replace(/^\s*#.*$/gmu, '');

const prohibited = /(?:pg_promote|nsupdate|docker\s+(?:run|compose\s+up)|RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY)/imu;

test('tenant governance deployment is root-gated, writer-only and backup-attested', () => {
  assert.match(deploy, /\[ "\$\(id -u\)" -eq 0 \]/);
  assert.match(deploy, /LEMTEL_TENANT_GOVERNANCE_EXECUTE:-\}.*deploy_verified_tenant_governance/);
  assert.match(deploy, /LEMTEL_HA_ROLE:-\}.*digitalocean_writer/);
  assert.match(deploy, /FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED/);
  assert.match(deploy, /SELECT pg_is_in_recovery\(\)::text/);
  assert.match(deploy, /flock -n 9/);
});

test('tenant governance deployment verifies only Lemtel portal and authority sources', () => {
  for (const required of ['0012_lemtel_membership_governance.sql', 'lemtel-onboarding-admin.index.ts', 'lemtelTelephonyReadiness.ts', 'portal.tar', 'manifest.sha256', 'manifest_digest_mismatch']) assert.match(deploy, new RegExp(required.replace(/[.]/g, '\\.')));
  assert.match(deploy, /membership_assigned/);
  assert.match(deploy, /membership_reactivated/);
  assert.match(deploy, /membership_role_changed/);
  assert.match(deploy, /lemtel_membership_authority_revision_after_change/);
});

test('tenant governance deployment restores runtime files and never touches external topology', () => {
  assert.match(deploy, /rollback_files\(\)/);
  assert.match(deploy, /backup_function/);
  assert.match(deploy, /backup_catalog/);
  assert.match(deploy, /dns_change_executed=false/);
  assert.match(deploy, /automatic_traffic_failover_enabled=false/);
  assert.match(deploy, /telephony_provider_contacted=false/);
  assert.doesNotMatch(executable, prohibited);
  assert.match(doc, /Aucun compte Auth, mot de passe, e-mail ou enregistrement métier n’est créé/);
});
