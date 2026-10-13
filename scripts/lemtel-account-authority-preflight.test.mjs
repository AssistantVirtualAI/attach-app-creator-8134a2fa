import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-account-authority-preflight.sh'), 'utf8');
const prohibited = /(?:\bpg_promote\b|docker\s+(?:restart|compose\s+up)|\bnsupdate\b|\bcurl\b|resend\.com|--delete)/imu;

test('account-authority preflight is read-only and verifies only redacted prerequisites', () => {
  assert.match(script, /account_authority_preflight_status=complete/u);
  assert.match(script, /LEMTEL_HA_ROLE:-.*digitalocean_writer/u);
  assert.match(script, /pg_is_in_recovery/u);
  assert.match(script, /function_mount_missing/u);
  assert.match(script, /lemtel_password_reset_throttles/u);
  assert.match(script, /account_authority_revision/u);
  assert.match(script, /GOTRUE_DISABLE_SIGNUP/u);
  assert.match(script, /RESEND_API_KEY/u);
  assert.match(script, /LEMTEL_WELCOME_FROM/u);
  assert.match(script, /credential_values_emitted=false/u);
  assert.match(script, /database_mutated=false/u);
  assert.match(script, /edge_runtime_restarted=false/u);
  assert.match(script, /email_sent=false/u);
  assert.match(script, /hostinger_contacted=false/u);
  assert.doesNotMatch(script, prohibited);
});
