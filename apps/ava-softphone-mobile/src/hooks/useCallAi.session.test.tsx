import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const channel: any = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation(() => channel);
  channel.subscribe.mockImplementation(() => channel);
  return { channel, transcribe: vi.fn(), analyze: vi.fn(), detail: vi.fn(), remove: vi.fn() };
});
vi.mock('../lib/mobileApi', () => ({ mobileApi: { transcribeCall: h.transcribe, analyzeCall: h.analyze, callDetail: h.detail } }));
vi.mock('../lib/mobileSupabase', () => ({ supabase: { channel: () => h.channel, removeChannel: h.remove } }));

import { useCallAi } from './useCallAi';

beforeEach(() => {
  for (const f of [h.transcribe, h.analyze, h.detail, h.remove]) f.mockReset();
  h.detail.mockResolvedValue({ id: 'cdr-a', transcript: [] });
  h.analyze.mockResolvedValue({});
});
afterEach(() => cleanup());

describe('Phase 30A — AI work respects mobile session unmount', () => {
  it('does not analyze a call after its recording panel was removed', async () => {
    let finish!: (value: any) => void;
    h.transcribe.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useCallAi('cdr-a', { autoLoad: false }));
    await act(async () => { void result.current.run(); await Promise.resolve(); });
    expect(h.transcribe).toHaveBeenCalledWith('cdr-a', expect.any(Object));
    unmount();
    await act(async () => { finish({ transcript_text: 'Old caller secret' }); await Promise.resolve(); });
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('a new CDR is not blocked by the old request and ignores its late result', async () => {
    let finish!: (value: any) => void;
    h.transcribe.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ transcript_text: 'New caller' });
    const { result, rerender } = renderHook(({ id }) => useCallAi(id, { autoLoad: false }), { initialProps: { id: 'cdr-a' } });
    await act(async () => { void result.current.run(); await Promise.resolve(); });
    rerender({ id: 'cdr-b' });
    await act(async () => { void result.current.run(); await Promise.resolve(); });
    expect(h.transcribe).toHaveBeenCalledWith('cdr-b', expect.any(Object));
    await act(async () => { finish({ transcript_text: 'Old caller secret' }); await Promise.resolve(); });
    expect(h.analyze).toHaveBeenCalledTimes(1);
    expect(h.analyze.mock.calls[0][0]).toBe('cdr-b');
  });
});
