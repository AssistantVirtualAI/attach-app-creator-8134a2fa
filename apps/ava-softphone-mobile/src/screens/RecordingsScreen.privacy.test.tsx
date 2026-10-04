// Lemtel Phase 27A — Mobile recordings are own_extension_only. Local mocks only: no network, audio or AI calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  const ch: any = { on: vi.fn(), subscribe: vi.fn() };
  ch.on.mockImplementation(() => ch);
  ch.subscribe.mockImplementation(() => ch);
  return {
    ch,
    channel: vi.fn((_name: string) => ch),
    removeChannel: vi.fn(),
    recordings: vi.fn(),
    me: vi.fn(),
    restGet: vi.fn(),
    download: vi.fn(),
    cached: vi.fn(async () => null),
    toast: vi.fn(),
  };
});

vi.mock('../lib/mobileApi', () => ({ mobileApi: { recordings: h.recordings, me: h.me } }));
vi.mock('../lib/mobileSupabase', () => ({
  supabase: { channel: h.channel, removeChannel: h.removeChannel, realtime: { setAuth: vi.fn() } },
  restGet: h.restGet,
  loadPbxRecordingAudioMobile: vi.fn(),
}));
vi.mock('../lib/recordingCache', () => ({ downloadRecording: h.download, getCachedRecordingUrl: h.cached }));
vi.mock('../lib/mobileToast', () => ({ showMobileToast: h.toast }));
vi.mock('../hooks/useCallAi', () => ({
  useCallAi: () => ({ data: { summary: 'Personal summary' }, loading: false, running: false, stage: 'idle', error: null, run: vi.fn() }),
}));
vi.mock('../lib/i18n', () => ({ useT: () => ({ lang: 'en' }) }));

import RecordingsScreen from './RecordingsScreen';

const own = { id: 'r1', from: '5145550000', to: '201', extension: '201', organization_id: 'org-test', customer: 'Own Caller', startedAt: new Date().toISOString(), durationSec: 60, hasTranscript: true };

const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const creds: any = { userId: 'user-test', organizationId: 'org-test', extension: '201', accessToken: 'token-test' };
const Screen = (p: any) => <RecordingsScreen creds={creds} rangeDays={7} onRangeDaysChange={() => {}} {...p} />;

beforeEach(() => {
  for (const f of [h.channel, h.removeChannel, h.recordings, h.me, h.restGet, h.download, h.cached, h.toast, h.ch.on, h.ch.subscribe]) f.mockClear();
  h.cached.mockResolvedValue(null);
  h.recordings.mockResolvedValue([own]);
  h.ch.on.mockImplementation(() => h.ch);
  h.ch.subscribe.mockImplementation(() => h.ch);
  h.channel.mockImplementation(() => h.ch);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Phase 27A — RecordingsScreen own_extension_only', () => {
  it('a legacy admin prop shows no extension selector or domain label', async () => {
    const legacy: any = { isAdmin: true };
    const { container } = render(<Screen myExtension="201" {...legacy} />);
    await flush();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toMatch(/All extensions|Toutes les extensions|domain|domaine/i);
    expect(h.restGet).not.toHaveBeenCalled();
    expect(h.me).not.toHaveBeenCalled();
    expect(screen.getByTestId('recordings-own-extension').textContent).toContain('201');
  });

  it('loads with recordings({ rangeDays }) only, no extension argument', async () => {
    render(<Screen myExtension="201" />);
    await flush();
    expect(h.recordings).toHaveBeenCalledWith({ rangeDays: 7 });
    for (const c of h.recordings.mock.calls) {
      expect(c.length).toBe(1);
      expect(JSON.stringify(c)).not.toContain('extension');
    }
  });

  it('without extension: no load and no realtime channel', async () => {
    const { container } = render(<Screen myExtension={null} />);
    await flush();
    expect(h.recordings).not.toHaveBeenCalled();
    expect(h.channel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recordings-own-extension')).toBeNull();
    expect(container.textContent).not.toMatch(/domain|domaine/i);
  });

  it('refuses rows returned for a different extension or organization', async () => {
    h.recordings.mockResolvedValueOnce([own,
      { ...own, id: 'r2', extension: '305', customer: 'Other extension' },
      { ...own, id: 'r3', organization_id: 'org-other', customer: 'Other organization' },
    ]);
    render(<Screen myExtension="201" />);
    await flush();
    expect(screen.getByText('Own Caller')).toBeTruthy();
    expect(screen.queryByText('Other extension')).toBeNull();
    expect(screen.queryByText('Other organization')).toBeNull();
  });

  it('realtime channel is named with the extension and filtered exactly by it', async () => {
    render(<Screen myExtension="201" />);
    await waitFor(() => expect(h.ch.subscribe).toHaveBeenCalled());
    expect(h.channel).toHaveBeenCalledTimes(1);
    expect(h.channel.mock.calls[0][0]).toBe('recordings-ext-201');
    const specs = h.ch.on.mock.calls.map((c: any[]) => c[1]);
    expect(specs.length).toBe(2);
    for (const s of specs) {
      expect(s.filter).toBe('extension=eq.201');
      expect(JSON.stringify(s)).not.toContain('organization_id');
    }
  });

  it('reload depends only on the extension-filtered channel callback', async () => {
    render(<Screen myExtension="201" />);
    await waitFor(() => expect(h.ch.subscribe).toHaveBeenCalled());
    h.recordings.mockClear();
    const cb = h.ch.on.mock.calls[0][2];
    await act(async () => { cb({ new: { extension: '201' } }); });
    await flush();
    expect(h.recordings).toHaveBeenCalledWith({ rangeDays: 7 });
    expect(h.channel).toHaveBeenCalledTimes(1);
  });

  it('unmount removes the channel and the listeners', async () => {
    const rem = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Screen myExtension="201" />);
    await waitFor(() => expect(h.ch.subscribe).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(h.removeChannel).toHaveBeenCalledWith(h.ch));
    const names = rem.mock.calls.map((c) => c[0]);
    expect(names).toContain('focus');
    expect(names).toContain('ava:callEnded');
  });

  it('play, download and AI panel remain rendered for a personal recording', async () => {
    render(<Screen myExtension="201" />);
    await flush();
    expect(screen.getByText('▶')).toBeTruthy();
    expect(screen.getByTitle('Download for offline playback')).toBeTruthy();
    fireEvent.click(screen.getByText('Own Caller'));
    await flush();
    expect(screen.getByText('Personal summary')).toBeTruthy();
  });

  it('ignores a focus refresh from the previous extension', async () => {
    let resolveOld!: (rows: any[]) => void;
    const { rerender } = render(<Screen myExtension="201" />);
    await flush();
    h.recordings.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    h.recordings.mockResolvedValue([{ ...own, id: 'r-new', extension: '202', customer: 'Current caller' }]);
    rerender(<Screen myExtension="202" creds={{ ...creds, extension: '202' }} />);
    expect(screen.queryByText('Own Caller')).toBeNull();
    await flush();
    await act(async () => { resolveOld([own]); await Promise.resolve(); });
    expect(screen.queryByText('Own Caller')).toBeNull();
    expect(screen.getByText('Current caller')).toBeTruthy();
  });

  it('ignores a late playback download from the prior account', async () => {
    let resolveOld!: (url: string) => void;
    h.download.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender, container } = render(<Screen myExtension="201" />);
    await flush();
    fireEvent.click(screen.getByText('▶'));
    await flush();
    rerender(<Screen myExtension="201" creds={{ ...creds, userId: 'user-b', accessToken: 'token-b' }} />);
    await flush();
    await act(async () => { resolveOld('blob:previous-account'); await Promise.resolve(); });
    expect((container.querySelector('audio') as HTMLAudioElement).getAttribute('src')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.download.mock.calls[0][5]).toMatchObject({ scope: { userId: 'user-test', organizationId: 'org-test', extension: '201' } });
  });
});
