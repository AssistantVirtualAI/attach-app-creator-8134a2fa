// Lemtel Phase 28A — Mobile local notifications are own_extension_only. Local mocks only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

const h = vi.hoisted(() => {
  const created: any[] = [];
  const makeChannel = (name: string) => {
    const ch: any = { name, specs: [] as any[], cbs: [] as Array<(p: any) => void> };
    ch.on = vi.fn((_t: string, spec: any, cb: (p: any) => void) => { ch.specs.push(spec); ch.cbs.push(cb); return ch; });
    ch.subscribe = vi.fn(() => ch);
    created.push(ch);
    return ch;
  };
  const listenerRemove = vi.fn();
  return {
    created,
    channel: vi.fn((name: string) => makeChannel(name)),
    removeChannel: vi.fn(),
    setAuth: vi.fn(),
    show: vi.fn(),
    listenerRemove,
    addListener: vi.fn(async () => ({ remove: listenerRemove })),
  };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('../lib/mobileSupabase', () => ({ supabase: { channel: h.channel, removeChannel: h.removeChannel, realtime: { setAuth: h.setAuth } } }));
vi.mock('../lib/localNotifications', () => ({
  initNotificationChannels: vi.fn(async () => {}),
  ensureNotificationPermission: vi.fn(async () => true),
  showLocalNotification: h.show,
}));
vi.mock('../lib/appRouter', () => ({ navigateTo: vi.fn() }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { addListener: h.addListener } }));

import { useDeviceNotifications } from './useDeviceNotifications';

const creds = (extension: string | null) => ({ accessToken: 'test-access', extension, organizationId: 'org-test' } as any);
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const byName = (n: string) => h.created.find((c) => c.name === n);

beforeEach(() => {
  h.created.length = 0;
  vi.clearAllMocks();
  h.channel.mockImplementation((name: string) => {
    const ch: any = { name, specs: [] as any[], cbs: [] as Array<(p: any) => void> };
    ch.on = vi.fn((_t: string, spec: any, cb: (p: any) => void) => { ch.specs.push(spec); ch.cbs.push(cb); return ch; });
    ch.subscribe = vi.fn(() => ch);
    h.created.push(ch);
    return ch;
  });
  h.addListener.mockImplementation(async () => ({ remove: h.listenerRemove }));
});
afterEach(() => { cleanup(); });

describe('Phase 28A — useDeviceNotifications own_extension_only', () => {
  it('creates only CDR and voicemail channels, named and filtered by the extension', async () => {
    renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    expect(h.created.map((c) => c.name).sort()).toEqual(['notif-cdr-201', 'notif-vm-201']);
    for (const c of h.created) for (const s of c.specs) expect(s.filter).toBe('extension=eq.201');
    expect(byName('notif-cdr-201').specs.map((s: any) => s.table)).toEqual(['pbx_call_records']);
    expect(byName('notif-vm-201').specs.map((s: any) => s.table)).toEqual(['pbx_voicemails']);
  });

  it('no channel spec mentions organization, SMS, recording or raw fields', async () => {
    renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    const text = JSON.stringify(h.created.map((c) => ({ name: c.name, specs: c.specs })));
    for (const bad of ['organization_id', 'to_extension', 'from_extension', 'raw_data', 'sms', 'recording']) expect(text.toLowerCase().includes(bad), bad).toBe(false);
  });

  it('without extension no Realtime channel is created', async () => {
    renderHook(() => useDeviceNotifications(creds(null)));
    await flush();
    expect(h.channel).not.toHaveBeenCalled();
    expect(h.show).not.toHaveBeenCalled();
  });

  it('missed inbound CDR of 201 notifies', async () => {
    renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    byName('notif-cdr-201').cbs[0]({ new: { id: 'c1', extension: '201', direction: 'inbound', billsec: 0, caller_number: '5145550000' } });
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.show.mock.calls[0][0]).toMatchObject({ kind: 'missed_call', dedupeKey: 'missed-c1' });
  });

  it('a voicemail CDR no longer produces a voicemail notification', async () => {
    renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    byName('notif-cdr-201').cbs[0]({ new: { id: 'c2', extension: '201', direction: 'inbound', billsec: 0, voicemail_message: true } });
    expect(h.show).not.toHaveBeenCalled();
  });

  it('voicemail insert of 201 notifies once; a 305 payload is ignored', async () => {
    renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    const cb = byName('notif-vm-201').cbs[0];
    cb({ new: { id: 'v1', extension: '201', caller_id_number: '5145550000' } });
    cb({ new: { id: 'v2', extension: '305', caller_id_number: '5145550009' } });
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.show.mock.calls[0][0]).toMatchObject({ kind: 'voicemail', dedupeKey: 'vm-v1', extra: { voicemailId: 'v1', route: 'voicemail' } });
  });

  it('cleanup removes exactly the created channels and the native listener', async () => {
    const { unmount } = renderHook(() => useDeviceNotifications(creds('201')));
    await flush();
    unmount();
    expect(h.removeChannel).toHaveBeenCalledTimes(2);
    for (const c of h.created) expect(h.removeChannel).toHaveBeenCalledWith(c);
    expect(h.listenerRemove).toHaveBeenCalledTimes(1);
  });
});
