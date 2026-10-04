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
    channel: vi.fn(() => ch),
    removeChannel: vi.fn(),
    recordings: vi.fn(),
    me: vi.fn(),
    restGet: vi.fn(),
    download: vi.fn(),
  };
});

vi.mock('../lib/mobileApi', () => ({ mobileApi: { recordings: h.recordings, me: h.me } }));
vi.mock('../lib/mobileSupabase', () => ({
  supabase: { channel: h.channel, removeChannel: h.removeChannel, realtime: { setAuth: vi.fn() } },
  restGet: h.restGet,
  loadPbxRecordingAudioMobile: vi.fn(),
}));
vi.mock('../lib/recordingCache', () => ({ downloadRecording: h.download, getCachedRecordingUrl: vi.fn(async () => null) }));
vi.mock('../lib/mobileToast', () => ({ showMobileToast: vi.fn() }));
vi.mock('../hooks/useCallAi', () => ({
  useCallAi: () => ({ data: { summary: 'Personal summary' }, loading: false, running: false, stage: 'idle', error: null, run: vi.fn() }),
}));
vi.mock('../lib/i18n', () => ({ useT: () => ({ lang: 'en' }) }));

import RecordingsScreen from './RecordingsScreen';

const own = { id: 'r1', from: '5145550000', to: '201', extension: '201', customer: 'Own Caller', startedAt: new Date().toISOString(), durationSec: 60, hasTranscript: true };

const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const Screen = (p: any) => <RecordingsScreen creds={null} rangeDays={7} onRangeDaysChange={() => {}} {...p} />;

beforeEach(() => {
  for (const f of [h.channel, h.removeChannel, h.recordings, h.me, h.restGet, h.download, h.ch.on, h.ch.subscribe]) f.mockClear();
  h.recordings.mockResolvedValue([own]);
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
});
