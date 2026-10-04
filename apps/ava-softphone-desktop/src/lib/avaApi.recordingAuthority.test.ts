// Phase 29C — real Desktop API payloads, mocked HTTP only (no PBX or database).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({}) } },
}));

import { ava, getMeContext, setAuthToken } from './avaApi';

const forged = {
  id: '11111111-1111-4111-8111-111111111111',
  callId: '22222222-2222-4222-8222-222222222222',
  pbx_uuid: '33333333-3333-4333-8333-333333333333',
  organization_id: 'foreign-org', extension: '999',
  recording_path: '/foreign/private', record_path: '/forged/path',
  recording_name: 'foreign.wav', record_name: 'forged.mp3',
  domain_uuid: 'foreign-domain', domain_name: 'foreign.example',
  recording_url: 'https://evil.example/audio', recordingUrl: 'https://evil.example/alternate',
  recordedAt: '2001-01-01T00:00:00Z',
};

function calls() {
  return vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    url: String(url), headers: init?.headers as Record<string, string>,
    body: JSON.parse(String(init?.body)),
  }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:authorized-audio');
  setAuthToken('session-token');
});
afterEach(() => { setAuthToken(null); vi.unstubAllGlobals(); });

describe('Phase 29C — same authorized CDR lookup for Desktop audio', () => {
  it('signed playback sends only a CDR key and expiry, never client metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, url: 'https://storage.example/signed', expiresInSec: 300, contentType: 'audio/wav' }) } as Response);
    expect((await ava.getRecordingSignedUrl(forged))?.url).toBe('https://storage.example/signed');
    expect(calls()[0].body).toEqual({ action: 'get-recording-signed-url', params: { xml_cdr_uuid: forged.callId, expires_in: 300 } });
    expect(calls()[0].headers.Authorization).toBe('Bearer session-token');
    expect(calls()[0].url).toContain('/functions/v1/fusionpbx-proxy');
  });

  it('fallback streams bytes from the same authenticated proxy with only the CDR key', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'audio/mpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response);
    expect(await ava.getRecordingAudioUrl(forged)).toBe('blob:authorized-audio');
    expect(calls()[0].body).toEqual({ action: 'get-recording', params: { xml_cdr_uuid: forged.callId } });
    expect(calls()[0].headers.Authorization).toBe('Bearer session-token');
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/mpeg' }));
  });

  it('neither fallback nor signed path uses a forged URL, including after a 403', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    expect(await ava.getRecordingSignedUrl(forged)).toBeNull();
    expect(await ava.getRecordingAudioUrl(forged)).toBeNull();
    expect(calls().map(c => c.body.params)).toEqual([
      { xml_cdr_uuid: forged.callId, expires_in: 300 },
      { xml_cdr_uuid: forged.callId },
    ]);
    expect(calls().every(c => c.url.includes('/functions/v1/fusionpbx-proxy'))).toBe(true);
  });

  it('fails closed without a CDR identifier or an authenticated token', async () => {
    expect(await ava.getRecordingSignedUrl({ recording_name: 'forged.wav' })).toBeNull();
    expect(await ava.getRecordingAudioUrl({ recording_url: 'https://evil.example/a' })).toBeNull();
    setAuthToken(null);
    expect(await ava.getRecordingSignedUrl(forged)).toBeNull();
    expect(await ava.getRecordingAudioUrl(forged)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards late signed URLs and audio bytes from a previous auth generation', async () => {
    let resolveSigned!: (value: Response) => void;
    let resolveBytes!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSigned = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveBytes = resolve; }));
    const signed = ava.getRecordingSignedUrl(forged);
    setAuthToken('new-session');
    resolveSigned({ ok: true, json: async () => ({ ok: true, url: 'https://storage.example/old' }) } as Response);
    expect(await signed).toBeNull();
    const binary = ava.getRecordingAudioUrl(forged);
    setAuthToken(null);
    resolveBytes({ ok: true, headers: new Headers({ 'content-type': 'audio/wav' }), arrayBuffer: async () => new Uint8Array([1]).buffer } as Response);
    expect(await binary).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('an old in-flight user lookup cannot populate the next session cache', async () => {
    const jwt = (sub: string) => `header.${btoa(JSON.stringify({ sub }))}.signature`;
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => [{ organization_id: 'new-org', extension: '305', portal_user_id: 'new-user' }] } as Response);
    setAuthToken(jwt('old-user'));
    const old = getMeContext();
    setAuthToken(jwt('new-user'));
    const current = getMeContext();
    resolveOld({ ok: true, json: async () => [{ organization_id: 'old-org', extension: '201', portal_user_id: 'old-user' }] } as Response);
    expect((await old).extension).toBeNull();
    expect((await current).extension).toBe('305');
    expect((await getMeContext()).extension).toBe('305');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
