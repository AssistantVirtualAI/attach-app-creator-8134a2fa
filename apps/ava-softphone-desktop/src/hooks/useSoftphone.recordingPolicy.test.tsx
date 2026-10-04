/**
 * Lemtel Phase 24B — useSoftphone refuses manual recording unless the validated
 * portal policy is exactly 'user_allowed'. Local mocks only: no network, PBX,
 * WebSocket, Electron or device. extension '' keeps the hook in passthrough mode (no SIP init).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ sendDTMF: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/sip/jssipProvider', () => ({
  sipProvider: {
    getSnapshot: () => ({ status: 'registered', callState: 'active', callUuid: 'uuid-1', muted: false, onHold: false }),
    subscribe: () => () => {},
    init: vi.fn(), sendDTMF: h.sendDTMF, unavailableReason: () => null,
    mute: vi.fn(), unmute: vi.fn(), hold: vi.fn(), unhold: vi.fn(), hangup: vi.fn(), answer: vi.fn(),
  },
}));
vi.mock('@/lib/sip/ringtonePlayer', () => ({ ringtone: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('@/lib/supabaseClient', () => ({
  SB_URL: 'http://test.invalid', SB_KEY: 'k',
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }), setSession: vi.fn() }, functions: { invoke: h.invoke } },
}));

import { useSoftphone } from './useSoftphone';

const mount = (recordingPolicy?: any) => renderHook(() => useSoftphone({ extension: '', recordingPolicy }));

beforeEach(() => {
  h.sendDTMF.mockReset();
  h.invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden in test'); }));
});

describe('useSoftphone — Phase 24B recording policy', () => {
  for (const p of ['not_allowed', 'portal_managed', undefined, 'always', '']) {
    it(`policy ${String(p)}: toggleRecording sends no *2, no PBX fallback, no state change`, async () => {
      const { result } = mount(p);
      expect(result.current.manualRecordingAllowed).toBe(false);
      expect(result.current.recordingPolicy).toBe(p === 'portal_managed' ? 'portal_managed' : 'not_allowed');
      await act(async () => { await result.current.toggleRecording(); });
      expect(h.sendDTMF).not.toHaveBeenCalled();
      expect(h.invoke).not.toHaveBeenCalled();
      expect(result.current.recording).toBe(false);
    });
  }

  it('user_allowed keeps *2 and the historical fallback', async () => {
    const { result } = mount('user_allowed');
    expect(result.current.manualRecordingAllowed).toBe(true);
    await act(async () => { await result.current.toggleRecording(); });
    expect(h.sendDTMF).toHaveBeenCalledWith('*2');
    expect(h.invoke).toHaveBeenCalledWith('fusionpbx-proxy', { body: { action: 'start-record', uuid: 'uuid-1' } });
    expect(result.current.recording).toBe(true);
  });

  it('other call controls are unchanged by the policy', () => {
    const { result } = mount('portal_managed');
    for (const k of ['mute', 'unmute', 'hold', 'unhold', 'hangup', 'sendDTMF', 'blindTransfer']) expect(typeof (result.current as any)[k]).toBe('function');
    result.current.sendDTMF('5');
    expect(h.sendDTMF).toHaveBeenCalledWith('5');
  });
});
