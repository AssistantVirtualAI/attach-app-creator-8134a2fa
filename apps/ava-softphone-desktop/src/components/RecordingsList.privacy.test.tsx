// Lemtel Phase 27B — Desktop Recordings are own_extension_only. Local mocks only: no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  const handlers: Array<(p: any) => void> = [];
  const ch: any = { on: vi.fn(), subscribe: vi.fn() };
  const q: any = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  const invoke = vi.fn();
  const authHandlers: Array<(event: string, session: any) => void> = [];
  return {
    handlers, ch, q, invoke, authHandlers,
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

vi.mock('@/lib/supabaseClient', () => ({ supabase: { channel: h.channel, removeChannel: h.removeChannel, from: h.from, functions: { invoke: h.invoke }, auth: { onAuthStateChange: (cb: any) => { h.authHandlers.push(cb); return { data: { subscription: { unsubscribe: () => { const i = h.authHandlers.indexOf(cb); if (i >= 0) h.authHandlers.splice(i, 1); } } } }; } } } }));
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
  h.authHandlers.length = 0;
  vi.clearAllMocks();
  URL.revokeObjectURL = vi.fn();
  h.ch.on.mockImplementation((_t: string, _f: any, cb: (p: any) => void) => { h.handlers.push(cb); return h.ch; });
  h.ch.subscribe.mockImplementation(() => h.ch);
  h.q.select.mockImplementation(() => h.q);
  h.q.in.mockResolvedValue({ data: [] });
  h.q.eq.mockImplementation(() => h.q);
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
    render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    expect(h.personalRecordings).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.recordings).not.toHaveBeenCalled();
    expect(h.refreshRecordings).not.toHaveBeenCalled();
  });

  it('Refresh calls refreshPersonalRecordings only', async () => {
    render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText('↻ Refresh'));
    await flush();
    expect(h.refreshPersonalRecordings).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.refreshRecordings).not.toHaveBeenCalled();
  });

  it('never shows a foreign extension row', async () => {
    render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    expect(screen.queryByText(/5145550001/)).not.toBeNull();
    expect(screen.queryByText(/5145550009/)).toBeNull();
  });

  it('does not mistake the other party number for the CDR extension', async () => {
    h.personalRecordings.mockResolvedValue([{ ...foreign, caller_number: '201', from: '201' }]);
    render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    expect(screen.queryByText(/5145550009/)).toBeNull();
    expect(screen.queryByText(/Load (PBX )?call audio/)).toBeNull();
  });

  it('without extension: no API, no Realtime, empty list', async () => {
    render(<RecordingsList extension={null} sessionUserId="user-a" />);
    await flush();
    expect(h.personalRecordings).not.toHaveBeenCalled();
    expect(h.refreshPersonalRecordings).not.toHaveBeenCalled();
    expect(h.channel).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    expect(screen.queryByText(/extension and session are assigned/)).not.toBeNull();
  });

  it('extension change clears data and ignores a late answer from the old extension', async () => {
    let resolveOld: (v: any) => void = () => {};
    h.personalRecordings.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    h.personalRecordings.mockImplementationOnce(async () => [rec('c', '305', '5145550777')]);
    const { rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    await act(async () => { resolveOld([own]); });
    await flush();
    expect(screen.queryByText(/5145550001/)).toBeNull();
    expect(screen.queryByText(/5145550777/)).not.toBeNull();
  });

  it('Realtime is filtered by extension and cleaned on unmount', async () => {
    const { unmount } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
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
    const { container, rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    await flush();
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:test-audio-a');
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(h.getRecordingSignedUrl).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-audio-a');
  });

  it('a different user on the same extension cannot see or replay cached audio', async () => {
    const { container, rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    await flush();
    expect(container.querySelector('audio')).not.toBeNull();
    rerender(<RecordingsList extension="201" sessionUserId="user-b" />);
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-audio-a');
  });

  it('sign-out immediately stops playback, clears rows and blocks late audio', async () => {
    const pending = deferred<any>();
    h.getRecordingSignedUrl.mockImplementationOnce(() => pending.promise);
    const { container } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    await act(async () => { for (const cb of [...h.authHandlers]) cb('SIGNED_OUT', null); });
    await act(async () => { pending.resolve({ url: 'blob:late' }); });
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.queryByText(/5145550001/)).toBeNull();
    expect(h.getRecordingAudioUrl).not.toHaveBeenCalled();
  });

  it('a token refresh for the same user keeps the active player', async () => {
    const { container } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    await flush();
    await act(async () => { for (const cb of [...h.authHandlers]) cb('TOKEN_REFRESHED', { user: { id: 'user-a' } }); });
    expect(container.querySelector('audio')).not.toBeNull();
  });

  it('analysis sends an identifier only, not client-provided audio pointers', async () => {
    h.personalRecordings.mockResolvedValue([{ ...own, recording_path: '/forged/path', recording_url: 'https://evil.example/a', xml_cdr_uuid: 'forged-pbx-id' }]);
    h.invoke.mockResolvedValueOnce({ error: { message: 'not available' } });
    render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Transcribe & Analyze/));
    await flush();
    expect(h.invoke).toHaveBeenCalledWith('ai-transcribe-call', {
      body: { callId: 'a', call_record_id: 'a', organization_id: '71755d33-ed64-4ad5-a828-61c9d2029eb7' },
    });
  });
});

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe('Phase 27B.1 — stale async work from an old session is inert', () => {
  it('late audio URL of A does not appear for B', async () => {
    const d = deferred<any>();
    h.getRecordingSignedUrl.mockImplementationOnce(() => d.promise);
    h.personalRecordings.mockResolvedValueOnce([own]).mockResolvedValueOnce([rec('a', '305', '5145550001')]);
    const { container, rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    await act(async () => { d.resolve({ url: 'blob:stale-a' }); });
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.innerHTML).not.toContain('blob:stale-a');
    expect(screen.queryByText(/Loading (PBX )?call audio/)).toBeNull();
  });

  it('late audio recovery of A does not modify B', async () => {
    const d = deferred<any>();
    h.getRecordingSignedUrl.mockResolvedValueOnce({ url: 'blob:broken-a' });
    h.getRecordingAudioUrl.mockImplementationOnce(() => d.promise);
    h.personalRecordings.mockResolvedValueOnce([own]).mockResolvedValueOnce([rec('a', '305', '5145550001')]);
    const { container, rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    fireEvent.click(screen.getByText(/Load (PBX )?call audio/));
    await flush();
    fireEvent.error(container.querySelector('audio')!);
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    await act(async () => { d.resolve('blob:recovered-a'); });
    await flush();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.innerHTML).not.toContain('blob:recovered-a');
  });

  it('late transcript hydration of A does not modify B rows or statuses', async () => {
    const d = deferred<any>();
    h.q.in.mockImplementationOnce(() => d.promise);
    h.personalRecordings.mockResolvedValueOnce([own]).mockResolvedValueOnce([rec('a', '305', '5145550001')]);
    const { rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    await act(async () => { d.resolve({ data: [{ call_record_id: 'a', transcript_text: 'stale transcript', provider: 'x' }] }); });
    await flush();
    expect(screen.queryByText(/Succeeded/)).toBeNull();
    expect(screen.queryByText(/stale transcript/)).toBeNull();
  });

  it('late analysis of A does not modify B and never calls onAnalyze', async () => {
    const d = deferred<any>();
    h.invoke.mockImplementationOnce(() => d.promise);
    h.personalRecordings.mockResolvedValueOnce([own]).mockResolvedValueOnce([rec('a', '305', '5145550001')]);
    const onAnalyze = vi.fn();
    const { rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" onAnalyze={onAnalyze} />);
    await flush();
    const btn = screen.getAllByRole('button').find((b) => /analy|transcri/i.test(b.textContent || ''))!;
    fireEvent.click(btn);
    rerender(<RecordingsList extension="305" sessionUserId="user-a" onAnalyze={onAnalyze} />);
    await flush();
    await act(async () => { d.resolve({ error: { message: 'stale failure' } }); });
    await flush();
    expect(onAnalyze).not.toHaveBeenCalled();
    expect(screen.queryByText(/stale failure/)).toBeNull();
    expect(screen.queryByText(/Failed/)).toBeNull();
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it('A → B → A ignores the first answer of A (session generation)', async () => {
    const first = deferred<any>();
    h.personalRecordings
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce([rec('b', '305', '5145550777')])
      .mockResolvedValueOnce([rec('c', '201', '5145550888')]);
    const { rerender } = render(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    rerender(<RecordingsList extension="305" sessionUserId="user-a" />);
    await flush();
    rerender(<RecordingsList extension="201" sessionUserId="user-a" />);
    await flush();
    await act(async () => { first.resolve([rec('old', '201', '5145550111')]); });
    await flush();
    expect(screen.queryByText(/5145550111/)).toBeNull();
    expect(screen.queryByText(/5145550888/)).not.toBeNull();
  });
});
