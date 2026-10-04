// Lemtel Phase 26B — Desktop Recents are own_extension_only. Local mocks only: no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  const handlers: Array<(p: any) => void> = [];
  const ch: any = { on: vi.fn(), subscribe: vi.fn() };
  ch.on.mockImplementation((_t: string, _f: any, cb: (p: any) => void) => { handlers.push(cb); return ch; });
  ch.subscribe.mockImplementation(() => ch);
  return {
    handlers, ch,
    channel: vi.fn(() => ch),
    removeChannel: vi.fn(),
    personalCalls: vi.fn(),
    refreshPersonalCalls: vi.fn(),
    calls: vi.fn(),
    refreshCalls: vi.fn(),
  };
});

vi.mock('@/lib/supabaseClient', () => ({ supabase: { channel: h.channel, removeChannel: h.removeChannel } }));
vi.mock('@/lib/avaApi', () => ({
  ava: { personalCalls: h.personalCalls, refreshPersonalCalls: h.refreshPersonalCalls, calls: h.calls, refreshCalls: h.refreshCalls },
}));
vi.mock('./ui/SkeletonRows', () => ({ default: () => <div>loading</div> }));

import RecentsList from './RecentsList';

const own = { id: 'a', direction: 'in', status: 'answered', from: '5145550000', to: '201', extension: '201', customer: 'Own Caller', startedAt: new Date().toISOString(), durationSec: 5 };
const foreign = { id: 'b', direction: 'in', status: 'answered', from: '5145559999', to: '305', extension: '305', customer: 'Foreign Caller', startedAt: new Date().toISOString(), durationSec: 5 };

beforeEach(() => {
  h.handlers.length = 0;
  for (const f of [h.channel, h.removeChannel, h.personalCalls, h.refreshPersonalCalls, h.calls, h.refreshCalls, h.ch.on, h.ch.subscribe]) f.mockClear();
  h.personalCalls.mockResolvedValue([own, foreign]);
  h.refreshPersonalCalls.mockResolvedValue([own, foreign]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('Phase 26B — RecentsList own_extension_only', () => {
  it('loads with personalCalls only', async () => {
    render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    expect(h.personalCalls).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.calls).not.toHaveBeenCalled();
    expect(h.refreshCalls).not.toHaveBeenCalled();
  });

  it('Reload calls refreshPersonalCalls only', async () => {
    render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    fireEvent.click(screen.getByLabelText('Reload CDR'));
    await flush();
    expect(h.refreshPersonalCalls).toHaveBeenCalledWith(200, { rangeDays: 7 });
    expect(h.refreshCalls).not.toHaveBeenCalled();
  });

  it('drops foreign rows before display', async () => {
    render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    expect(screen.getByText('Own Caller')).toBeTruthy();
    expect(screen.queryByText('Foreign Caller')).toBeNull();
    expect(screen.getByTestId('recents-own-extension').textContent).toContain('My extension 201');
  });

  it('realtime channel is filtered exactly by extension, never by organization', async () => {
    render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    expect(h.channel).toHaveBeenCalledTimes(1);
    const key = h.channel.mock.calls[0][0] as string;
    expect(key).toContain('201');
    expect(key).not.toContain('org');
    const filters = h.ch.on.mock.calls.map((c: any[]) => c[1]);
    expect(filters.map((f: any) => f.event).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const f of filters) {
      expect(f.filter).toBe('extension=eq.201');
      expect(f.table).toBe('pbx_call_records');
      expect(JSON.stringify(f)).not.toContain('organization_id');
    }
  });

  it('foreign realtime event is ignored; own event refreshes after debounce', async () => {
    render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    vi.useFakeTimers();
    h.personalCalls.mockClear();
    act(() => { h.handlers[0]({ new: { extension: '305', caller_number: '305' } }); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(h.personalCalls).not.toHaveBeenCalled();
    act(() => { h.handlers[0]({ new: { extension: '201' } }); });
    act(() => { vi.advanceTimersByTime(299); });
    expect(h.personalCalls).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(h.personalCalls).toHaveBeenCalledTimes(1);
  });

  it('without extension: no read, no channel, waiting state', async () => {
    render(<RecentsList extension="" onCall={() => {}} />);
    await flush();
    expect(h.personalCalls).not.toHaveBeenCalled();
    expect(h.refreshPersonalCalls).not.toHaveBeenCalled();
    expect(h.channel).not.toHaveBeenCalled();
    expect(screen.getByText(/available as soon as an extension is assigned/)).toBeTruthy();
  });

  it('unmount removes the channel and clears timers', async () => {
    const { unmount } = render(<RecentsList extension="201" onCall={() => {}} />);
    await flush();
    vi.useFakeTimers();
    h.personalCalls.mockClear();
    act(() => { h.handlers[0]({ new: { extension: '201' } }); });
    unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(h.ch);
    vi.advanceTimersByTime(5000);
    expect(h.personalCalls).not.toHaveBeenCalled();
  });
});
