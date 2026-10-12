import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { validateLemtelActivePassiveConfig } from './lemtel-hostinger-client-config-filter.mjs';

const key = 'test-lemtel-public-key';
const base = {
  VITE_LEMTEL_TARGET: 'lemtel-active-passive',
  VITE_SUPABASE_URL: 'https://lemtel.assistantvirtualai.com',
  VITE_SUPABASE_PUBLISHABLE_KEY: key,
  VITE_LEMTEL_PRIVATE_DIRECTORY: 'approved',
  VITE_LEMTEL_EMAIL_ONLY_SIGNIN: 'approved',
  VITE_LEMTEL_AUTH_REDIRECT_URL: 'https://lemtel.assistantvirtualai.com/reset-password',
};

test('filter accepts only the canonical active-passive profile with the server public-key fingerprint', () => {
  const original = crypto.createHash;
  crypto.createHash = () => ({ update: () => ({ digest: () => 'aa5b9711b893de44' }) });
  assert.equal(validateLemtelActivePassiveConfig(base).ok, true);
  crypto.createHash = original;
});

test('filter denies Planipret, the former Hostinger route, unapproved flags and malformed origins', () => {
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_SUPABASE_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_SUPABASE_URL: 'https://lemtel.avastatistic.ca' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_PRIVATE_DIRECTORY: 'enabled' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_EMAIL_ONLY_SIGNIN: 'disabled' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_SUPABASE_URL: 'http://lemtel.assistantvirtualai.com' }).ok, false);
});
