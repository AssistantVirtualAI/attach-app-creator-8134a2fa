import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({}) } },
}));

import { BACKEND } from './config';
import { ava, MOCK, setAuthToken } from './avaApi';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setAuthToken('synthetic-jwt');
});
afterEach(() => { setAuthToken(null); vi.unstubAllGlobals(); });

describe('Phase 31I — résolution des routes Desktop (réseau simulé)', () => {
  it('garde les fonctions et la base sur une seule origine de build', async () => {
    expect(MOCK).toBe(false);
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: 'ok' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    await ava.systemStatus();
    await ava.devices();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, `${BACKEND.url}/functions/v1/fusionpbx-proxy`, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ apikey: BACKEND.anonKey, Authorization: 'Bearer synthetic-jwt' }),
      body: JSON.stringify({ action: 'system-status' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, `${BACKEND.url}/rest/v1/pbx_devices?select=*&order=label.asc`, expect.objectContaining({
      headers: expect.objectContaining({ apikey: BACKEND.anonKey, Authorization: 'Bearer synthetic-jwt' }),
    }));
    for (const [value] of vi.mocked(fetch).mock.calls) expect(new URL(String(value)).origin).toBe(BACKEND.url);
  });

  it('ne revient pas à l’origine historique pour Edge ou REST avec un build isolé', async () => {
    vi.doMock('./backendOrigin', () => ({
      BACKEND_URL: 'https://self-hosted.example', BACKEND_ANON_KEY: 'sb_publishable_synthetic',
    }));
    vi.resetModules();
    try {
      const { ava: customAva, setAuthToken: setCustomToken } = await import('./avaApi');
      setCustomToken('synthetic-jwt');
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
      await customAva.systemStatus();
      await customAva.devices();
      expect(vi.mocked(fetch).mock.calls.map(([value]) => String(value))).toEqual([
        'https://self-hosted.example/functions/v1/fusionpbx-proxy',
        'https://self-hosted.example/rest/v1/pbx_devices?select=*&order=label.asc',
      ]);
    } finally { vi.doUnmock('./backendOrigin'); vi.resetModules(); }
  });
});
