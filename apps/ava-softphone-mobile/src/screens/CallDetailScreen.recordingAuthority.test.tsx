// Lemtel Phase 29B — CallDetailScreen uses the single authenticated audio helper.
// Fully simulated: no real URL, token, network, PBX or device.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  callDetail: vi.fn(),
  loadAudio: vi.fn(),
  mobile: { userId: 'user-test', accessToken: 'tok-test', organizationId: 'org-test', fusionpbxDomainUuid: 'dom-fallback-test', extension: '201' },
}));

vi.mock('../lib/mobileApi', () => ({
  mobileApi: { callDetail: h.callDetail },
}));
vi.mock('../lib/mobileSupabase', () => ({ loadPbxRecordingAudioMobile: h.loadAudio }));
vi.mock('../hooks/useMobileCredentials', () => ({
  useMobileCredentials: () => h.mobile,
}));
vi.mock('../lib/mobileToast', () => ({ showMobileToast: vi.fn() }));
vi.mock('../lib/i18n', () => ({ useT: () => ({ lang: 'en' }) }));
vi.mock('./RecordingDebugScreen', () => ({ default: () => null }));

import CallDetailScreen from './CallDetailScreen';

const cdr = (over: any = {}) => ({
  id: 'c1', pbx_uuid: 'pbx-1', hasRecording: true, record_path: '/rec/a', record_name: 'a.mp3',
  domain_uuid: 'dom-cdr', organization_id: 'org-cdr', start_at: '2026-01-01T00:00:00Z',
  from: '201', to: '5145550000', customer: 'Own', startedAt: '2026-01-01T00:00:00Z', durationSec: 30,
  transcript: [], insights: null, ...over,
});

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

describe('Phase 29B — CallDetailScreen recording authority', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    h.callDetail.mockReset();
    h.loadAudio.mockReset();
    h.mobile = { userId: 'user-test', accessToken: 'tok-test', organizationId: 'org-test', fusionpbxDomainUuid: 'dom-fallback-test', extension: '201' };
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Audio', vi.fn(() => ({ pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('calls the shared helper with a CDR identifier only', async () => {
    h.callDetail.mockResolvedValue(cdr());
    h.loadAudio.mockResolvedValue('https://signed.test/a');
    render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    expect(h.loadAudio).toHaveBeenCalledTimes(1);
    const [meta, token, org, fallback] = h.loadAudio.mock.calls[0];
    expect(meta).toEqual({ xml_cdr_uuid: 'pbx-1', id: 'c1' });
    expect(meta).not.toHaveProperty('action');
    expect(meta).not.toHaveProperty('headers');
    expect([token, org, fallback]).toEqual(['tok-test', 'org-test', 'dom-fallback-test']);
  });

  it('never fetches the proxy directly', async () => {
    h.callDetail.mockResolvedValue(cdr());
    h.loadAudio.mockResolvedValue('https://signed.test/a');
    render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Forbidden shows a generic user error without backend detail', async () => {
    h.callDetail.mockResolvedValue(cdr());
    const e: any = new Error('Forbidden: path /rec/a on pbx.example [ref: x]');
    e.code = 'Forbidden'; e.http_status = 403;
    h.loadAudio.mockRejectedValue(e);
    render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    expect(screen.getByText(/not allowed to listen to this call/)).toBeTruthy();
    const txt = document.body.textContent || '';
    expect(txt).not.toContain('/rec/a');
    expect(txt).not.toContain('pbx.example');
  });

  it('no recording: helper never called', async () => {
    h.callDetail.mockResolvedValue(cdr({ hasRecording: false }));
    render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    expect(h.loadAudio).not.toHaveBeenCalled();
  });

  it('changing call id does not reuse the previous CDR metadata', async () => {
    h.callDetail.mockImplementation(async (id: string) =>
      id === 'c1' ? cdr() : cdr({ id: 'c2', pbx_uuid: 'pbx-2', record_path: '/rec/b', record_name: 'b.mp3' }));
    h.loadAudio.mockResolvedValue('https://signed.test/x');
    const { rerender } = render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    rerender(<CallDetailScreen id="c2" onBack={() => {}} />);
    await flush();
    const last = h.loadAudio.mock.calls[h.loadAudio.mock.calls.length - 1][0];
    expect(last.xml_cdr_uuid).toBe('pbx-2');
    expect(last).toEqual({ xml_cdr_uuid: 'pbx-2', id: 'c2' });
    expect(h.loadAudio.mock.calls.every((c) => !('record_name' in c[0]))).toBe(true);
  });

  it('does not reuse a signed URL returned after switching accounts with the same CDR id', async () => {
    let resolveOld!: (url: string) => void;
    h.callDetail.mockResolvedValue(cdr());
    h.loadAudio.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue('https://signed.test/user-b');
    const { rerender } = render(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    h.mobile = { ...h.mobile, userId: 'user-b', accessToken: 'tok-b' };
    rerender(<CallDetailScreen id="c1" onBack={() => {}} />);
    await flush();
    await act(async () => { resolveOld('https://signed.test/user-a'); await Promise.resolve(); });
    expect(h.loadAudio).toHaveBeenCalledTimes(2);
    expect(h.loadAudio.mock.calls[1][1]).toBe('tok-b');
    expect(document.body.textContent).not.toContain('user-a');
  });
});
