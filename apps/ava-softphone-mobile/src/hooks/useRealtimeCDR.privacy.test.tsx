/**
 * Lemtel Phase 26A — Mobile CDR history is own_extension_only, even for admins.
 * Local mocks only: no network, no call, no write, no env, no credential.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const calls = vi.fn();
vi.mock('../lib/mobileApi', () => ({ mobileApi: { calls: (...a: any[]) => calls(...a) } }));

type Handler = { event: string; filter: string; cb: (p: any) => void };
const channels: { name: string; handlers: Handler[]; sub?: (s: string) => void }[] = [];
const removeChannel = vi.fn();
vi.mock('../lib/mobileSupabase', () => {
  const supabase = {
    realtime: { setAuth: vi.fn() },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    channel: (name: string) => {
      const ch: any = { name, handlers: [] as Handler[] };
      ch.on = (_t: string, opts: any, cb: any) => { ch.handlers.push({ event: opts.event, filter: opts.filter, cb }); return ch; };
      ch.subscribe = (fn: any) => { ch.sub = fn; return ch; };
      channels.push(ch);
      return ch;
    },
    removeChannel: (c: any) => removeChannel(c),
  };
  return { supabase, SUPABASE_URL: 'mock', SUPABASE_ANON: 'mock' };
});

import { useRealtimeCDR } from './useRealtimeCDR';

const admin = { accessToken: 'tok', extension: '201', organizationId: 'org-1', dataScope: 'domain_admin', permissions: { admin: true } } as any;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Phase 26A — useRealtimeCDR privacy', () => {
  beforeEach(() => { channels.length = 0; calls.mockReset(); calls.mockResolvedValue([]); removeChannel.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('loads with rangeDays + limit only, never an extension option', async () => {
    const { unmount } = renderHook(() => useRealtimeCDR(admin, 30));
    await flush();
    expect(calls).toHaveBeenCalled();
    for (const c of calls.mock.calls) {
      expect(c[0]).toEqual({ rangeDays: 30, limit: 20 });
      expect('extension' in c[0]).toBe(false);
    }
    unmount();
  });

  it('admin channel is filtered exactly on the signed-in extension; no organization filter', async () => {
    const { unmount } = renderHook(() => useRealtimeCDR(admin, 7));
    await flush();
    expect(channels.length).toBe(1);
    expect(channels[0].name.startsWith('cdr-ext-201-')).toBe(true);
    for (const h of channels[0].handlers) expect(h.filter).toBe('extension=eq.201');
    expect(JSON.stringify(channels[0].handlers.map((h) => h.filter))).not.toContain('organization_id');
    unmount();
  });

  it('ignores rows from another extension and accepts own rows', async () => {
    const { result, unmount } = renderHook(() => useRealtimeCDR(admin, 7));
    await flush();
    const ins = channels[0].handlers.find((h) => h.event === 'INSERT')!;
    act(() => { ins.cb({ new: { id: 'other-row-1', extension: '999', billsec: 5 } }); });
    expect((result.current.calls || []).some((c) => c.id === 'other-row-1')).toBe(false);
    act(() => { ins.cb({ new: { id: 'own-row-001', extension: '201', billsec: 5 } }); });
    expect((result.current.calls || []).some((c) => c.id === 'own-row-001')).toBe(true);
    unmount();
  });

  it('without extension: no channel, idle transport, clear warning', async () => {
    const { result, unmount } = renderHook(() => useRealtimeCDR({ ...admin, extension: undefined }, 7));
    await flush();
    expect(channels.length).toBe(0);
    expect(result.current.transport).toBe('idle');
    expect(result.current.warning).toMatch(/extension is assigned/);
    unmount();
  });

  it('cleanup removes the channel and leaves no active timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderHook(() => useRealtimeCDR(admin, 7));
    await flush();
    expect(channels.length).toBe(1);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
