import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const script = readFileSync(resolve(import.meta.dirname, '../infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-password-recovery-preflight.sh'), 'utf8');

test('password-recovery preflight is explicitly root-gated, role-gated and read-only', () => {
  for (const expected of [
    '[ "$(id -u)" -eq 0 ]',
    'password_recovery_preflight',
    'digitalocean_promoted_writer',
    'supabase-edge-functions',
    'lemtel_password_reset_delivery_attempts',
    'lemtel_find_password_reset_recipient(text)',
    'password_recovery_ready=',
    'runtime_mutated=false',
    'credential_values_emitted=false',
  ]) assert.match(script, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('password-recovery preflight does not apply runtime, provider, network or telephony changes', () => {
  for (const forbidden of [
    /\b(?:doctl|hcloud|curl|wget)\b/i,
    /\b(?:systemctl|docker)\s+(?:start|restart|run|compose|cp|rm|mv)\b/i,
    /\b(?:iptables|ufw)\b/i,
    /(?:password|token|key)\s*=\s*[^\n]*(?:echo|printf)/i,
  ]) assert.doesNotMatch(script, forbidden);
});
