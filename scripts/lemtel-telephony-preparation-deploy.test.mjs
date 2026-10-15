import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const deployer = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-telephony-preparation-deploy.sh'), 'utf8');

test('telephony preparation deployer is root-gated, writer-only and requires a verified backup', () => {
  assert.match(deployer, /\[ "\$\(id -u\)" -eq 0 \]/);
  assert.match(deployer, /LEMTEL_TELEPHONY_PREPARATION_EXECUTE/);
  assert.match(deployer, /deploy_verified_telephony_preparation/);
  assert.match(deployer, /LEMTEL_HA_ROLE/);
  assert.match(deployer, /digitalocean_writer/);
  assert.match(deployer, /FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED/);
});

test('telephony preparation deployer carries only the declarative migration and server-authoritative portal sources', () => {
  assert.match(deployer, /0018_lemtel_telephony_preparation_governance\.sql/);
  assert.match(deployer, /lemtel_telephony_preparation_states/);
  assert.match(deployer, /lemtel_set_telephony_preparation_state/);
  assert.match(deployer, /lemtel-onboarding-admin\.index\.ts/);
  assert.match(deployer, /lemtelTelephonyReadiness\.ts/);
  assert.match(deployer, /lemtel-session-bootstrap\.index\.ts/);
  assert.match(deployer, /manifest_digest_mismatch/);
  assert.match(deployer, /portal_archive_unexpected_file/);
  assert.match(deployer, /rollback\(\)/);
});

test('telephony preparation deployer fails closed outside the Lemtel writer portal boundary', () => {
  for (const forbidden of [/pg_promote/i, /nsupdate/i, /cloudflare/i, /curl\b/i, /wget\b/i, /fusionpbx/i, /\bsip\b/i, /\bwss\b/i, /\bturn\b/i, /LEMTEL_[A-Z_]*(?:PASSWORD|SECRET)/]) {
    assert.doesNotMatch(deployer, forbidden);
  }
  assert.match(deployer, /telephony_provider_contacted=false/);
  assert.match(deployer, /automatic_traffic_failover_enabled=false/);
  assert.match(deployer, /fencing_executed=false/);
});
