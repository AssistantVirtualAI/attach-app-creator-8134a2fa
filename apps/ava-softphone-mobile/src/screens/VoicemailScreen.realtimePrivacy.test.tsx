/**
 * Lemtel Phase 29A — Mobile voicemail Realtime trigger scoped to the signed-in extension.
 * Fully simulated: local mocks only, no network, no real table, no PBX, no device.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';

type Sub = { spec: any; cb: (p: any) => void };
const channels: { name: string; subs: Sub[]; obj: any }[] = [];
const removed: any[] = [];
const creds = { current: { accessToken: 'test-token', extension: '201', domainUuid: 'dom-1' } as any };

vi.mock('../lib/mobileSupabase', () => ({
  edgeCall: vi.fn().mockResolvedValue({}),
  authedRealtime: () => ({
    channel: (name: string) => {
      const entry = { name, subs: [] as Sub[], obj: null as any };
      const obj: any = {
        on: (_t: string, spec: any, cb: any) => { entry.subs.push({ spec, cb }); return obj; },
        subscribe: () => obj,
      };
      entry.obj = obj;
      channels.push(entry);
      return obj;
    },
    removeChannel: (c: any) => { removed.push(c); },
  }),
}));
const voicemails = vi.fn();
vi.mock('../lib/mobileApi', () => ({
  mobileApi: { voicemails: (...a: any[]) => voicemails(...a), analyzeCall: vi.fn(), voicemailAudio: vi.fn() },
}));
vi.mock('../hooks/useMobileCredentials', () => ({ useMobileCredentials: () => creds.current }));
vi.mock('../lib/audit', () => ({ audit: vi.fn() }));

import VoicemailScreen from './VoicemailScreen';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('Phase 29A — VoicemailScreen Realtime privacy', () => {
  beforeEach(() => {
    cleanup();
    channels.length = 0;
    removed.length = 0;
    voicemails.mockReset();
    voicemails.mockResolvedValue([]);
    creds.current = { accessToken: 'test-token', extension: '201', domainUuid: 'dom-1' };
  });

  it('creates one channel named with 201, filtered extension=eq.201 on INSERT/UPDATE/DELETE', async () => {
    render(<VoicemailScreen />);
    await flush();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('vm-mobile-201');
    expect(channels[0].subs.map((s) => s.spec.event).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const s of channels[0].subs) {
      expect(s.spec.table).toBe('pbx_voicemails');
      expect(s.spec.schema).toBe('public');
      expect(s.spec.filter).toBe('extension=eq.201');
    }
  });

  it('no spec contains org/domain/sms/recording/raw_data or is unfiltered', async () => {
    render(<VoicemailScreen />);
    await flush();
    for (const s of channels[0].subs) {
      const j = JSON.stringify(s.spec);
      for (const bad of ['organization_id', 'domain_uuid', 'organizationId', 'domainUuid', 'sms', 'recording', 'raw_data']) {
        expect(j).not.toContain(bad);
      }
      expect(s.spec.filter).toBeTruthy();
    }
  });

  it('without extension: no channel, no Realtime reload', async () => {
    creds.current = { accessToken: 'test-token', extension: '  ', domainUuid: 'dom-1' };
    render(<VoicemailScreen />);
    await flush();
    expect(channels).toHaveLength(0);
  });

  it('INSERT/UPDATE for 201 reload, 305 ignored', async () => {
    render(<VoicemailScreen />);
    await flush();
    const base = voicemails.mock.calls.length;
    const get = (ev: string) => channels[0].subs.find((s) => s.spec.event === ev)!.cb;
    await act(async () => { get('INSERT')({ eventType: 'INSERT', new: { extension: '305' } }); });
    await act(async () => { get('UPDATE')({ eventType: 'UPDATE', new: { extension: '305' } }); });
    await flush();
    expect(voicemails.mock.calls.length).toBe(base);
    await act(async () => { get('INSERT')({ eventType: 'INSERT', new: { extension: '201' } }); });
    await flush();
    expect(voicemails.mock.calls.length).toBe(base + 1);
    await act(async () => { get('UPDATE')({ eventType: 'UPDATE', new: { extension: '201' } }); });
    await flush();
    expect(voicemails.mock.calls.length).toBe(base + 2);
  });

  it('DELETE uses payload.old: 201 reloads, 305 ignored', async () => {
    render(<VoicemailScreen />);
    await flush();
    const base = voicemails.mock.calls.length;
    const del = channels[0].subs.find((s) => s.spec.event === 'DELETE')!.cb;
    await act(async () => { del({ eventType: 'DELETE', old: { extension: '305' }, new: {} }); });
    await flush();
    expect(voicemails.mock.calls.length).toBe(base);
    await act(async () => { del({ eventType: 'DELETE', old: { extension: '201' }, new: {} }); });
    await flush();
    expect(voicemails.mock.calls.length).toBe(base + 1);
  });

  it('unmount removes the exact channel created', async () => {
    const { unmount } = render(<VoicemailScreen />);
    await flush();
    const created = channels[0].obj;
    unmount();
    expect(removed).toEqual([created]);
  });
});
