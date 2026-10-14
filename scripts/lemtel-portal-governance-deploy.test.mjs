import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-portal-governance-deploy.sh'), 'utf8');
const executable = source.replace(/^\s*#.*$/gmu, '');
const prohibited = /(?:pg_promote|nsupdate|docker\s+(?:run|compose\s+up)|\bturn\b|\bwss\b|\bsip\b|fusionpbx|resend|curl|wget|ssh)/imu;

test('portal governance deployment is writer-only, backup-attested and integrity-pinned', () => {
  assert.match(source, /\[ "\$\(id -u\)" -eq 0 \]/);
  assert.match(source, /LEMTEL_PORTAL_GOVERNANCE_EXECUTE/);
  assert.match(source, /LEMTEL_HA_ROLE:-\}" = digitalocean_writer/);
  assert.match(source, /FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED/);
  assert.match(source, /manifest_digest_mismatch/);
  assert.match(source, /portal_route_missing_or_ambiguous/);
  assert.match(source, /SELECT pg_is_in_recovery\(\)::text/);
});

test('deployment applies only approved Lemtel governance schema and atomically restores runtime files on error', () => {
  assert.match(source, /0012_lemtel_membership_governance\.sql/);
  assert.match(source, /0013_lemtel_organization_ownership_transfer\.sql/);
  assert.match(source, /0014_lemtel_client_session_controls\.sql/);
  assert.match(source, /lemtel_transfer_organization_ownership/);
  assert.match(source, /lemtel_session_bootstrap_context_for_client/);
  assert.match(source, /lemtel_record_authorized_client_connection/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /cp -- "\$admin_backup" "\$admin_target"/);
  assert.match(source, /docker restart --time 30 "\$edge_container"/);
  assert.match(source, /mv "\$portal_dir" "\$backup_dir\/lemtel-portal"/);
});

test('deployment does not control external topology, providers or telephony', () => {
  assert.match(source, /dns_change_executed=false/);
  assert.match(source, /hostinger_runtime_started=false/);
  assert.match(source, /automatic_traffic_failover_enabled=false/);
  assert.match(source, /fencing_executed=false/);
  assert.match(source, /telephony_provider_contacted=false/);
  assert.doesNotMatch(executable, prohibited);
});
