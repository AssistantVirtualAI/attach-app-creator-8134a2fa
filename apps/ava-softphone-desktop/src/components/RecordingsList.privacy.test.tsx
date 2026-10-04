// Lemtel Phase 27B — Desktop Recordings are own_extension_only. Local mocks only: no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  const handlers: Array<(p: any) => void> = [];
  const ch: any = { on: vi.fn(), subscribe: vi.fn() };
  const q: any = { select: vi.fn(), in: vi.fn() };
  return {
    handlers, ch, q,
    channel: vi.fn(() => ch),
    removeChannel: vi.fn(),
    from: vi.fn(() => q),
    personalRecordings: vi.fn(),
    refreshPersonalRecordings: vi.fn(),
    recordings: vi.fn(),
    refreshRecordings: vi.fn(),
    getRecordingSignedUrl: vi.fn(),
    getRecordingAudioUrl: vi.fn(),
  };
});

vi.mock('@/lib/supabaseClient', () => ({ supabase: { channel: h.channel, removeChannel: h.removeChannel, from: h.from, functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/avaApi', () => ({
  ava: {
    personalRecordings: h.personalRecordings, refreshPersonalRecordings: h.refreshPersonalRecordings,
    recordings: h.recordings, refreshRecordings: h.refreshRecordings,
    getRecordingSignedUrl: h.getRecordingSignedUrl, getRecordingAudioUrl: h.getRecordingAudioUrl,
  },
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('./ui/SkeletonRows', () => ({ default: () => <div>loading</div> }));

import RecordingsList from './RecordingsList';

const rec = (id: string, ext: string, from: string) => ({ id, callId: id, from, to: ext, extension: ext, recordedAt: new Date().toISOString(), durationSec: 5, recording_name: `${id}.wav` });
const own = rec('a', '201', '5145550001');
const foreign = rec('b', '305', '5145550009');

beforeEach(() => {
  h.handlers.length = 0;
  vi.clearAllMocks();
  h.ch.on.mockImplementation((_t: string, _f: any, cb: (p: any) => void) => { h.handlers.push(cb); return h.ch; });
  h.ch.subscribe.mockImplementation(() => h.ch);
  h.q.select.mockImplementation(() => h.q);
  h.q.in.mockResolvedValue({ data: [] });
  h.channel.mockImplementation(() => h.ch);
  h.from.mockImplementation(() => h.q);
  h.personalRecordings.mockResolvedValue([own, foreign]);
  h.refreshPersonalRecordings.mockResolvedValue([own, foreign]);
  h.getRecordingSignedUrl.mockResolvedValue({ url: 'blob:test-audio-a' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

describe('Phase 27B — RecordingsList own_extension_only', () => {
  it('loads with personalRecordings only', async () => {
    render(<RecordingsList extension="201" />);
    await flush();
    expect(h.personalRecordings).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.recordings).not.toHaveBeenCalled();
    expect(h.refreshRecordings).not.toHaveBeenCalled();
  });

  it('Refresh calls refreshPersonalRecordings only', async () => {
    render(<RecordingsList extension="201" />);
    await flush();
    fireEvent.click(screen.getByText('↻ Refresh'));
    await flush();
    expect(h.refreshPersonalRecordings).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.refreshRecordings).not.toHaveBeenCalled();
  });

  it('never shows a foreign extension row', async () => {
    render(<RecordingsList extension="201" />);
    await flush();
    expect(screen.queryByText(/5145550001/)).not.toBeNull();
    expect(screen.queryByText(/5145550009/)).toBeNull();
  });

  it('without extension: no API, no Realtime, empty list', async () => {
    render(<RecordingsList extension={null} />);
    await flush();
    expect(h.personalRecordings).not.toHaveBeenCalled();
    expect(h.refreshPersonalRecordings).not.toHaveBeenCalled();
    expect(h.channel).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    expect(screen.queryByText(/extension is assigned/)).not.toBeNull();
  });

  it('extension change clears data and ignores a late answer from the old extension', async () => {
    let resolveOld: (v: any) => void = () => {};
    h.personalRecordings.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    h.personalRecordings.mockImplementationOnce(async () => [rec('c', '305', '5145550777')]);
    const { rerender } = render(<RecordingsList extension="201" />);
    await flush();
    rerender(<RecordingsList extension="305" />);
    await flush();
    await act(async () => { resolveOld([own]); });
    await flush();
    expect(screen.queryByText(/5145550001/)).toBeNull();
    expect(screen.queryByText(/5145550777/)).not.toBeNull();
  });

  it('Realtime is filtered by extension and cleaned on unmount', async () => {
    const { unmount } = render(<RecordingsList extension="201" />);
    await flush();
    expect(h.channel).toHaveBeenCalledWith('rt-recordings-extension-201');
    const filters = h.ch.on.mock.calls.map((c: any[]) => c[1]);
    expect(filters.map((f: any) => f.event).sort()).toEqual(['INSERT', 'UPDATE']);
    for (const f of filters) expect(f).toMatchObject({ table: 'pbx_call_records', filter: 'extension=eq.201' });
    unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(h.ch);
  });

  it('audio URLs do not survive an extension change', async () => {
    h.personalRecordings.mockResolvedValue([own, rec('a', '305', '5145550001')]);
    const { container, rerender } = render(<RecordingsList extension="201" />);
    await flush();
    fireEvent.click(screen.getByText(/Load PBX audio/));
    await flush();
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:test-audio-a');
    rerender(<RecordingsList extension="305" />);
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(h.getRecordingSignedUrl).toHaveBeenCalledTimes(1);
  });
});
