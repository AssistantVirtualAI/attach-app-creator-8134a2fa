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
    await edgeCall('ai-analyze-call', 'synthetic-jwt', { call_record_id: 'synthetic-cdr' });

    expect(mock.fetch).toHaveBeenCalledTimes(3);
    expect(mock.fetch).toHaveBeenNthCalledWith(1, `${SUPABASE_URL}/rest/v1/pbx_call_records?select=id`, expect.objectContaining({
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    expect(mock.fetch).toHaveBeenNthCalledWith(2, `${SUPABASE_URL}/rest/v1/pbx_call_records`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ id: 'synthetic-cdr' }),
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    expect(mock.fetch).toHaveBeenNthCalledWith(3, `${SUPABASE_URL}/functions/v1/ai-analyze-call`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ call_record_id: 'synthetic-cdr' }),
      headers: expect.objectContaining({ apikey: SUPABASE_ANON, Authorization: 'Bearer synthetic-jwt' }),
    }));
    for (const [value] of mock.fetch.mock.calls) expect(new URL(String(value)).origin).toBe(SUPABASE_URL);
  });

  it('n’utilise aucun token précédent lorsque l’appel Edge est effectué sans session', async () => {
    await edgeCall('ai-transcribe-call', null, { call_record_id: 'synthetic-cdr' });
    const [, options] = mock.fetch.mock.calls[0];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', apikey: SUPABASE_ANON });
  });
});
