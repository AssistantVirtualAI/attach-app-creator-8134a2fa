// Phase 30A — mocked browser/network only, no PBX, storage or real credentials.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(), refreshSession: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: h.getSession, refreshSession: h.refreshSession }, realtime: { setAuth: vi.fn() } }),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

import { clearRecordingAudioCache, loadPbxRecordingAudioMobile } from './mobileSupabase';

const session = (id: string) => ({ access_token: `jwt-${id}`, user: { id }, expires_at: Math.floor(Date.now() / 1000) + 3600 });
const signed = (url: string) => ({ ok: true, status: 200, json: async () => ({ ok: true, url }) });
const recording = {
  id: 'cdr-1', xml_cdr_uuid: 'pbx-cdr-1', record_path: '/forged/path', record_name: 'other.mp3',
  organization_id: 'forged-org', domain_uuid: 'forged-domain', recording_url: 'https://evil.invalid/audio',
};

beforeEach(() => {
  clearRecordingAudioCache();
  h.getSession.mockReset().mockResolvedValue({ data: { session: session('user-a') } });
  h.refreshSession.mockReset();
  h.fetch.mockReset().mockResolvedValue(signed('https://signed.invalid/audio'));
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('Phase 30A — authenticated mobile audio contract', () => {
  it('sends only the CDR and asks the proxy again on every play', async () => {
    await loadPbxRecordingAudioMobile(recording, 'forged-jwt', 'forged-org', 'forged-domain');
    await loadPbxRecordingAudioMobile(recording);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of h.fetch.mock.calls) {
      expect(url).toContain('/fusionpbx-proxy');
      expect(init.headers.Authorization).toBe('Bearer jwt-user-a');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ action: 'get-recording-signed-url', params: { xml_cdr_uuid: 'pbx-cdr-1', expires_in: 300 } });
      expect(JSON.stringify(body)).not.toMatch(/forged|evil|record_path|record_name|domain_uuid|organization_id/);
    }
  });

  it('rejects a path without CDR and never falls back to a stale caller token', async () => {
    await expect(loadPbxRecordingAudioMobile({ record_path: '/x', record_name: 'x.wav' }, 'old-jwt')).rejects.toThrow('CDR');
    h.getSession.mockResolvedValue({ data: { session: null } });
    await expect(loadPbxRecordingAudioMobile(recording, 'old-jwt')).rejects.toThrow('Session expirée');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('does not retry an unauthorized CDR through the binary endpoint', async () => {
    h.fetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(loadPbxRecordingAudioMobile(recording)).rejects.toThrow('Accès refusé');
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a signed URL returned after logout or user switch', async () => {
    let finish!: (value: any) => void;
    h.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = loadPbxRecordingAudioMobile(recording);
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    clearRecordingAudioCache();
    finish(signed('https://signed.invalid/old-account'));
    await expect(pending).rejects.toThrow('Session changed');

    h.getSession.mockResolvedValueOnce({ data: { session: session('user-a') } })
      .mockResolvedValueOnce({ data: { session: session('user-b') } });
    await expect(loadPbxRecordingAudioMobile(recording)).rejects.toThrow('Session changed');
  });
});
