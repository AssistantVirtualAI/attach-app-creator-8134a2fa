import { describe, expect, it } from 'vitest';
import { BACKEND_URL, BACKEND_ANON_KEY, LEGACY_BACKEND_URL, resolveBackendConfig, resolveBackendOrigin, resolveResetRedirect } from './backendOrigin';

describe('Lemtel Desktop backend origin (offline phase 31A)', () => {
  it('preserves existing deployments until a reviewed cutover build', () => {
    expect(resolveBackendOrigin(undefined, undefined)).toBe(LEGACY_BACKEND_URL);
    expect(BACKEND_URL).toBe(LEGACY_BACKEND_URL);
  });

  it('uses a custom bare HTTPS origin only with a new publishable key', () => {
    expect(resolveBackendOrigin('https://api.lemtel.example/', 'sb_publishable_test')).toBe('https://api.lemtel.example');
    expect(() => resolveBackendOrigin('https://api.lemtel.example', undefined)).toThrow(/publishable key/);
    expect(() => resolveBackendOrigin('https://api.lemtel.example', BACKEND_ANON_KEY)).toThrow(/publishable key/);
  });

  it.each(['http://api.lemtel.example', 'https://api.lemtel.example/path',
    'https://api.lemtel.example#fragment', 'https://name:password@api.lemtel.example', 'invalid'])
  ('refuses invalid destinations: %s', (origin) => {
    expect(() => resolveBackendOrigin(origin, 'sb_publishable_test')).toThrow();
  });

  it('requires a dedicated publishable key and a different storage namespace for cutover', () => {
    expect(resolveBackendConfig({}).storageSuffix).toBe('');
    expect(() => resolveBackendConfig({ VITE_SUPABASE_URL: 'https://api.lemtel.example',
      VITE_SUPABASE_ANON_KEY: 'another-key' })).toThrow(/publishable key/);
    const selected = resolveBackendConfig({ VITE_SUPABASE_URL: 'https://api.lemtel.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new', VITE_SUPABASE_ANON_KEY: BACKEND_ANON_KEY });
    expect(selected.key).toBe('sb_publishable_new');
    expect(selected.storageSuffix).not.toBe('');
  });

  it('requires a reviewed HTTPS reset target before a new Auth issuer can email a link', () => {
    expect(resolveResetRedirect(LEGACY_BACKEND_URL, undefined)).toBe('https://avastatistic.ca/reset-password');
    expect(() => resolveResetRedirect('https://api.lemtel.example', undefined)).toThrow();
    expect(resolveResetRedirect('https://api.lemtel.example', 'https://auth.lemtel.example/reset-password'))
      .toBe('https://auth.lemtel.example/reset-password');
  });
});
