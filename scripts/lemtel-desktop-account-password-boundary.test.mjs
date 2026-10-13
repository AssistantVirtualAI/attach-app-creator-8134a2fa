import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dirname, '../apps/ava-softphone-desktop/src/hooks/useSoftphone.ts'), 'utf8');

test('Desktop accepts calling credentials only from its authenticated server endpoint', () => {
  assert.match(source, /functions\/v1\/softphone-credentials/);
  assert.match(source, /Authorization:\s*`Bearer \$\{accessToken\}`/);
});

test('Desktop never reads, persists, or pushes an account password from client storage', () => {
  for (const forbidden of [
    'lemtel.sip_password',
    'local_account_password',
    'softphone-sync-password',
    'force_local_to_pbx',
  ]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
