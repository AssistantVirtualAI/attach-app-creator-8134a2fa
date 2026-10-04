import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKEND, SIP, fetchSoftphoneCredentials, fnUrl } from './config';

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('Phase 31I — routes Edge du Desktop (réseau simulé)', () => {
  it('résout le nom Edge sous la seule origine backend configurée', () => {
    expect(fnUrl(SIP.credentialsFn)).toBe(`${BACKEND.url}/functions/v1/softphone-credentials`);
    expect(new URL(fnUrl(SIP.credentialsFn)).origin).toBe(BACKEND.url);
  });

  it('obtient les identifiants SIP via la fonction authentifiée sur la même origine', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ extension: '301', password: 'mock-only' }) } as Response);
    const result = await fetchSoftphoneCredentials('synthetic-jwt');
    expect(result.extension).toBe('301');
    expect(result.sipDomain).toBe(SIP.domain);
    expect(result.wssUrl).toBe(SIP.wssUrl);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${BACKEND.url}/functions/v1/softphone-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: BACKEND.anonKey, Authorization: 'Bearer synthetic-jwt' },
    });
  });

  it('ne contourne pas la fonction Edge si elle répond en erreur', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await expect(fetchSoftphoneCredentials('synthetic-jwt')).rejects.toThrow('softphone-credentials 403');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
