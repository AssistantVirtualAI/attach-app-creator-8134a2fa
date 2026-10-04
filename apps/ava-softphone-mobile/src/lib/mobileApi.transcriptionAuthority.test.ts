import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('./mobileSupabase', () => ({ supabase: { auth: { getSession: h.getSession } } }));
vi.mock('./buildGuard', () => ({ isMockMode: () => false }));

import { configureMobileApi, mobileApi } from './mobileApi';

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'jwt-user' } } });
  h.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ transcript_text: 'ok' }) });
  vi.stubGlobal('fetch', h.fetch);
  configureMobileApi({ portalUrl: 'https://test.invalid', accessToken: 'jwt-user' });
});
afterEach(() => vi.unstubAllGlobals());

describe('Phase 30A — mobile transcription request', () => {
  it('sends only a CDR/recording identifier and supported options', async () => {
    await mobileApi.transcribeCall('00000000-0000-4000-8000-000000000001', { force: true, disableClaude: true });
    const [url, init] = h.fetch.mock.calls[0];
    expect(url).toBe('https://test.invalid/functions/v1/ai-transcribe-call');
    expect(init.headers.Authorization).toBe('Bearer jwt-user');
    expect(JSON.parse(init.body)).toEqual({
      call_record_id: '00000000-0000-4000-8000-000000000001', force: true, disable_claude: true,
    });
  });

  it('asks the server to analyze its persisted transcript, never a mobile-supplied one', async () => {
    await mobileApi.analyzeCall('00000000-0000-4000-8000-000000000001', { force: true });
    const [url, init] = h.fetch.mock.calls[0];
    expect(url).toBe('https://test.invalid/functions/v1/ai-analyze-call');
    expect(JSON.parse(init.body)).toEqual({
      call_id: '00000000-0000-4000-8000-000000000001',
      call_record_id: '00000000-0000-4000-8000-000000000001',
      force: true,
    });
  });
});
