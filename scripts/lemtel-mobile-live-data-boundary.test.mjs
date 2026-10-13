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

test('live calls, recordings and messages use the canonical authenticated API boundary', () => {
  for (const endpoint of ['/mobile-calls?', '/mobile-recordings?', '/mobile-sms']) {
    assert.ok(source.includes(endpoint), `missing canonical endpoint: ${endpoint}`);
  }
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
});
