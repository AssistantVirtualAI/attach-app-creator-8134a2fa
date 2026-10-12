import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'https://lemtel.assistantvirtualai.com';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.VITE_LEMTEL_AUTH_REDIRECT_URL = 'https://lemtel.assistantvirtualai.com/reset-password';
});

import { BACKEND_URL, LEMTEL_CANONICAL_BACKEND_URL, resolveBackendConfig, resolveBackendOrigin, resolveResetRedirect } from './backendOrigin';

const CANONICAL_KEY = 'sb_publishable_test';

describe('Lemtel mobile canonical backend origin', () => {
  it('requires the explicit canonical route for every Lemtel build', () => {
    expect(BACKEND_URL).toBe(LEMTEL_CANONICAL_BACKEND_URL);
    expect(() => resolveBackendOrigin(undefined, undefined)).toThrow(/canonical backend URL/);
  });

  it('accepts only the canonical HTTPS origin paired with a publishable key', () => {
    expect(resolveBackendOrigin('https://lemtel.assistantvirtualai.com/', CANONICAL_KEY)).toBe(LEMTEL_CANONICAL_BACKEND_URL);
  });

  it.each([
    'http://lemtel.assistantvirtualai.com',
    'https://lemtel.assistantvirtualai.com/v1',
    'https://lemtel.assistantvirtualai.com?redirect=1',
    'https://user:pass@lemtel.assistantvirtualai.com',
    'https://gejxisrqtvxavbrfcoxz.supabase.co',
    'https://api.lemtel.example',
    'not-an-origin',
  ])('rejects an insecure, ambiguous, or non-canonical origin: %s', (origin) => {
    expect(() => resolveBackendOrigin(origin, CANONICAL_KEY)).toThrow(/canonical backend URL|Invalid Lemtel backend URL/);
  });

  it('fails closed without an explicit publishable key', () => {
    expect(() => resolveBackendOrigin(LEMTEL_CANONICAL_BACKEND_URL, undefined)).toThrow(/publishable key/);
    expect(() => resolveBackendOrigin(LEMTEL_CANONICAL_BACKEND_URL, '')).toThrow(/publishable key/);
  });

  it('keeps storage scoped to the canonical origin and rejects legacy environment fields', () => {
    expect(() => resolveBackendConfig({})).toThrow(/canonical backend URL/);
    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'legacy-compatible-key',
    })).toThrow(/canonical backend URL/);

    expect(resolveBackendConfig({
      VITE_SUPABASE_URL: LEMTEL_CANONICAL_BACKEND_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: CANONICAL_KEY,
    })).toEqual({
      url: LEMTEL_CANONICAL_BACKEND_URL,
      key: CANONICAL_KEY,
      storageSuffix: `:${encodeURIComponent(LEMTEL_CANONICAL_BACKEND_URL)}`,
    });
  });

  it('accepts only the canonical password-reset URL', () => {
    expect(resolveResetRedirect(LEMTEL_CANONICAL_BACKEND_URL, 'https://lemtel.assistantvirtualai.com/reset-password'))
      .toBe('https://lemtel.assistantvirtualai.com/reset-password');
    expect(() => resolveResetRedirect(LEMTEL_CANONICAL_BACKEND_URL, 'https://avastatistic.ca/reset-password')).toThrow();
    expect(() => resolveResetRedirect('https://api.lemtel.example', 'https://lemtel.assistantvirtualai.com/reset-password')).toThrow();
  });
});
