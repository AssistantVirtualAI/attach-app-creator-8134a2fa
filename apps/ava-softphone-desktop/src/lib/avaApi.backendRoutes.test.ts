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
});
