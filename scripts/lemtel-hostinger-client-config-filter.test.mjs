import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { validateLemtelActivePassiveConfig } from './lemtel-hostinger-client-config-filter.mjs';

const key = 'test-lemtel-public-key';
const base = {
  VITE_LEMTEL_TARGET: 'lemtel-active-passive',
  VITE_LEMTEL_API_URL: 'https://lemtel.assistantvirtualai.com',
  VITE_LEMTEL_PUBLISHABLE_KEY: key,
  VITE_LEMTEL_PRIVATE_DIRECTORY: 'approved',
  VITE_LEMTEL_EMAIL_ONLY_SIGNIN: 'approved',
  VITE_LEMTEL_HOSTED_ONBOARDING: 'approved',
  VITE_LEMTEL_AUTH_REDIRECT_URL: 'https://lemtel.assistantvirtualai.com/reset-password',
};

test('filter accepts only the canonical active-passive profile with the server public-key fingerprint', () => {
  const original = crypto.createHash;
  crypto.createHash = () => ({ update: () => ({ digest: () => 'aa5b9711b893de44' }) });
  assert.equal(validateLemtelActivePassiveConfig(base).ok, true);
  crypto.createHash = original;
});

test('canonical build templates and workflows expose only namespaced Lemtel runtime variables', () => {
  const root = new URL('..', import.meta.url);
  const template = fs.readFileSync(new URL('./infra/lemtel-client-config/hostinger-staging.env.template', root), 'utf8');
  const workflow = fs.readFileSync(new URL('./.github/workflows/lemtel-hostinger-client-config-filter.yml', root), 'utf8');
  for (const source of [template, workflow]) {
    assert.match(source, /VITE_LEMTEL_API_URL/);
    assert.match(source, /VITE_LEMTEL_PUBLISHABLE_KEY/);
    assert.doesNotMatch(source, /VITE_SUPABASE_URL:/);
    assert.doesNotMatch(source, /VITE_SUPABASE_PUBLISHABLE_KEY:/);
  }
});

test('filter denies Planipret, the former Hostinger route, unapproved flags and malformed origins', () => {
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_API_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_API_URL: 'https://lemtel.avastatistic.ca' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_PRIVATE_DIRECTORY: 'enabled' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_SUPABASE_URL: 'https://lemtel.assistantvirtualai.com' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_EMAIL_ONLY_SIGNIN: 'disabled' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_HOSTED_ONBOARDING: 'disabled' }).ok, false);
  assert.equal(validateLemtelActivePassiveConfig({ ...base, VITE_LEMTEL_API_URL: 'http://lemtel.assistantvirtualai.com' }).ok, false);
});
