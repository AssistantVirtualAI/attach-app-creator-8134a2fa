import { describe, expect, it } from 'vitest';
import { BACKEND_URL, LEGACY_BACKEND_URL, resolveBackendConfig, resolveBackendOrigin, resolveResetRedirect } from './backendOrigin';

describe('Lemtel mobile backend origin (offline phase 31A)', () => {
  it('keeps existing installs on their current backend until an explicit cutover build', () => {
    expect(resolveBackendOrigin(undefined, undefined)).toBe(LEGACY_BACKEND_URL);
    expect(BACKEND_URL).toBe(LEGACY_BACKEND_URL);
  });

  it('selects a stable HTTPS origin when paired with its own publishable key', () => {
    expect(resolveBackendOrigin('https://api.lemtel.example/', 'sb_publishable_test')).toBe('https://api.lemtel.example');
  });

  it.each(['http://api.lemtel.example', 'https://api.lemtel.example/v1',
    'https://api.lemtel.example?redirect=1', 'https://user:pass@api.lemtel.example',
    'not-an-origin'])('rejects an insecure or ambiguous API origin: %s', (origin) => {
    expect(() => resolveBackendOrigin(origin, 'sb_publishable_test')).toThrow();
  });

  it('fails closed without a matching new publishable key', () => {
    expect(() => resolveBackendOrigin('https://api.lemtel.example', undefined)).toThrow(/publishable key/);
    expect(() => resolveBackendOrigin('https://api.lemtel.example', '')).toThrow(/publishable key/);
  });

  it('separates historic and cutover SDK sessions and requires an explicitly new key', () => {
    expect(resolveBackendConfig({}).storageSuffix).toBe('');
    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: 'https://api.lemtel.example',
      VITE_SUPABASE_ANON_KEY: 'old-compatible-key',
    })).toThrow(/publishable key/);
    const selected = resolveBackendConfig({
      VITE_SUPABASE_URL: 'https://api.lemtel.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new',
      VITE_SUPABASE_ANON_KEY: 'old-compatible-key',
    });
    expect(selected).toEqual({ url: 'https://api.lemtel.example', key: 'sb_publishable_new',
      storageSuffix: `:${encodeURIComponent('https://api.lemtel.example')}` });
  });

  it('does not redirect new Auth reset links to the historical marketing site', () => {
    expect(resolveResetRedirect(LEGACY_BACKEND_URL, undefined)).toBe('https://avastatistic.ca/reset-password');
    expect(() => resolveResetRedirect('https://api.lemtel.example', undefined)).toThrow();
    expect(resolveResetRedirect('https://api.lemtel.example', 'https://auth.lemtel.example/reset-password'))
      .toBe('https://auth.lemtel.example/reset-password');
    expect(() => resolveResetRedirect('https://api.lemtel.example', 'http://auth.lemtel.example/reset-password')).toThrow();
  });
});
