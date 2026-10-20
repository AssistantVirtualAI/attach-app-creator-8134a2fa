import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dirname, '../apps/ava-softphone-mobile/src/lib/mobileApi.ts'), 'utf8');

test('production Mobile accepts mock data only in explicitly opted-in development mode', () => {
  assert.match(source, /if \(isMockMode\(\)\) \{[\s\S]*return mockData;/);
  assert.match(source, /if \(!token\) \{[\s\S]*err\.code = 'AUTH_REQUIRED';[\s\S]*throw err;/);
  assert.doesNotMatch(source, /if \(!token\) \{[\s\S]{0,220}return mockData;/);
});

test('live calls, recordings and voicemail use the Lemtel gateway with the user session', () => {
  // The Lemtel backend serves telephony data only through lemtel-pbx (server-scoped to the user's extension).
  for (const action of ["action: 'cdr_list'", "action: 'self_overview'", "action: 'voicemail_audio'", 'recordedOnly: true']) {
    assert.ok(source.includes(action), `missing gateway action: ${action}`);
  }
  for (const legacy of ['/mobile-calls?', '/mobile-recordings?', '/mobile-voicemails', '/fusionpbx-proxy']) {
    assert.ok(!source.includes(legacy), `legacy endpoint still used: ${legacy}`);
  }
  const gateway = readFileSync(resolve(import.meta.dirname, '../apps/ava-softphone-mobile/src/lib/lemtelPbxMobile.ts'), 'utf8');
  assert.match(gateway, /functions\/v1\/lemtel-pbx/);
  assert.match(gateway, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
});
