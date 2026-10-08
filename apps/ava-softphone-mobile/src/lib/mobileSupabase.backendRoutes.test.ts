import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: {}, realtime: { setAuth: vi.fn() } }),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

import { SUPABASE_ANON, SUPABASE_URL, edgeCall, restGet, restPost } from './mobileSupabase';

beforeEach(() => {
  mock.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('Phase 31I — routes backend mobile (réseau simulé)', () => {
  it('conserve le même backend pour REST GET, REST POST et Edge', async () => {
    await restGet('/rest/v1/pbx_call_records?select=id', 'synthetic-jwt');
    await restPost('/rest/v1/pbx_call_records', 'synthetic-jwt', { id: 'synthetic-cdr' });
    await edgeCall('lemtel-session-bootstrap', 'synthetic-jwt', { call_record_id: 'synthetic-cdr' });

    expect(mock.fetch).toHaveBeenCalledTimes(3);
    expect(mock.fetch).toHaveBeenNthCalledWith(1, `${SUPABASE_URL}/rest/v1/pbx_call_records?select=id`, expect.objectContaining({
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    expect(mock.fetch).toHaveBeenNthCalledWith(2, `${SUPABASE_URL}/rest/v1/pbx_call_records`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ id: 'synthetic-cdr' }),
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    expect(mock.fetch).toHaveBeenNthCalledWith(3, `${SUPABASE_URL}/functions/v1/lemtel-session-bootstrap`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ call_record_id: 'synthetic-cdr' }),
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    for (const [value] of mock.fetch.mock.calls) expect(new URL(String(value)).origin).toBe(SUPABASE_URL);
  });

  it('n’utilise aucun token précédent lorsque l’appel Edge est effectué sans session', async () => {
    await edgeCall('lemtel-session-bootstrap', null, { call_record_id: 'synthetic-cdr' });
    const [, options] = mock.fetch.mock.calls[0];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', apikey: SUPABASE_ANON });
  });

  it('conserve la nouvelle clé publique et l’origine isolée pour REST et Edge', async () => {
    vi.doMock('./backendOrigin', () => ({
      BACKEND_URL: 'https://self-hosted.example', BACKEND_ANON_KEY: 'sb_publishable_synthetic',
      BACKEND_STORAGE_SUFFIX: ':synthetic',
    }));
    vi.resetModules();
    try {
      const custom = await import('./mobileSupabase');
      await custom.restGet('/rest/v1/pbx_call_records?select=id', 'synthetic-jwt');
      await custom.edgeCall('lemtel-session-bootstrap', 'synthetic-jwt', { call_record_id: 'synthetic-cdr' });
      expect(mock.fetch.mock.calls.map(([url, options]) => [String(url), options.headers.apikey])).toEqual([
        ['https://self-hosted.example/rest/v1/pbx_call_records?select=id', 'sb_publishable_synthetic'],
        ['https://self-hosted.example/functions/v1/lemtel-session-bootstrap', 'sb_publishable_synthetic'],
      ]);
    } finally { vi.doUnmock('./backendOrigin'); vi.resetModules(); }
  });
});
