import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { validateHostingerLemtelConfig } from './lemtel-hostinger-client-config-filter.mjs';

const key = 'test-hostinger-public-key';
const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
const base = { VITE_LEMTEL_TARGET: 'hostinger-staging', VITE_SUPABASE_URL: 'https://lemtel.avastatistic.ca', VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_LEMTEL_PRIVATE_DIRECTORY: 'approved', VITE_LEMTEL_AUTH_REDIRECT_URL: 'https://lemtel.avastatistic.ca/reset-password' };

test('filter accepts only a hostinger staging profile with the server public-key fingerprint', () => {
  const original = crypto.createHash;
  crypto.createHash = () => ({ update: () => ({ digest: () => 'aa5b9711b893de44' }) });
  assert.equal(validateHostingerLemtelConfig(base).ok, true);
  crypto.createHash = original;
});

test('filter denies Planipret, unapproved flags and malformed origins', () => {
  assert.equal(validateHostingerLemtelConfig({ ...base, VITE_SUPABASE_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co' }).ok, false);
  assert.equal(validateHostingerLemtelConfig({ ...base, VITE_LEMTEL_PRIVATE_DIRECTORY: 'enabled' }).ok, false);
  assert.equal(validateHostingerLemtelConfig({ ...base, VITE_SUPABASE_URL: 'http://lemtel.avastatistic.ca' }).ok, false);
});
