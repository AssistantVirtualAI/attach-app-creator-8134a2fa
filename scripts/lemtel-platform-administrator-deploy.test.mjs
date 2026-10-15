import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const source = readFileSync(resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-platform-administrator-deploy.sh'), 'utf8');
const executable = source.replace(/^\s*#.*$/gmu, '');
const prohibited = /(?:pg_promote|nsupdate|docker\s+(?:run|compose\s+up)|\bturn\b|\bwss\b|\bsip\b|fusionpbx|resend|curl|wget|ssh)/imu;
test('platform-administrator deployment is writer-only, backup-attested and integrity-pinned', () => {
  assert.match(source, /LEMTEL_PLATFORM_ADMIN_EXECUTE/);
  assert.match(source, /LEMTEL_PLATFORM_ADMIN_BUNDLE/);
  assert.doesNotMatch(source, /LEMTEL_PORTAL_GOVERNANCE_RECONCILE/);
  assert.match(source, /deploy_verified_platform_administration/);
  assert.match(source, /FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED/);
  assert.match(source, /manifest_digest_mismatch/);
  assert.match(source, /SELECT pg_is_in_recovery\(\)::text/);
});
test('platform-administrator deployment applies only the additive Lemtel audit schema', () => {
  assert.match(source, /0015_lemtel_organization_lifecycle\.sql/);
  assert.match(source, /0016_lemtel_platform_administrator_audit\.sql/);
  assert.match(source, /lemtel_platform_administrators/);
  assert.match(source, /lemtel_platform_administrator_audit/);
  assert.match(source, /platform_administrator_schema_not_ready/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /portal_archive_unexpected_file/);
});
test('platform-administrator deployment never creates accounts or controls topology or telephony', () => {
  assert.match(source, /database_business_data_mutation=false/);
  assert.match(source, /dns_change_executed=false/);
  assert.match(source, /hostinger_runtime_started=false/);
  assert.match(source, /automatic_traffic_failover_enabled=false/);
  assert.match(source, /telephony_provider_contacted=false/);
  assert.doesNotMatch(executable, prohibited);
});
