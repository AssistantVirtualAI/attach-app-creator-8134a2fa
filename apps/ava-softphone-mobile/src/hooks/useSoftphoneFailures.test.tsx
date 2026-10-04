/**
 * Integration tests for SIP failure → user-facing message classification,
 * plus the "Retrying…" status that the UI surfaces during the 2 s / 5 s
 * back-off window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSoftphone } from './useSoftphone';

vi.mock('../lib/sip/sipPersistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/sip/sipPersistence')>(),
  probeWss: vi.fn(async () => ({ ok: true, ms: 1 })),
}));

type Handler = (...a: any[]) => void;

function installFakeJsSIP() {
  const uaHandlers: Record<string, Handler[]> = {};
  const ua = {
    on: vi.fn((evt: string, cb: Handler) => {
      (uaHandlers[evt] = uaHandlers[evt] || []).push(cb);
    }),
    start: vi.fn(),
    stop: vi.fn(),
    call: vi.fn(),
    emit: (evt: string, ...a: any[]) => (uaHandlers[evt] || []).forEach((h) => h(...a)),
  };
  (window as any).JsSIP = {
    WebSocketInterface: vi.fn().mockImplementation(() => ({})),
    UA: vi.fn().mockImplementation(() => ua),
  };
  return ua;
}

const cfg = {
  extension: '300',
  password: 'pw',
  domain: 'lemtel.lemtel.tel',
  wssUrl: 'wss://node.lemtelcloud.net:7443',
  displayName: 'Test',
};

beforeEach(() => { delete (window as any).JsSIP; if (!(window as any).RTCPeerConnection) (window as any).RTCPeerConnection = vi.fn(); });
afterEach(() => { delete (window as any).JsSIP; });

describe('SIP failure classification → UI message', () => {
  it.each([
    { label: 'WSS connection failed',     emit: ['disconnected', { error: true, reason: 'WebSocket transport error' }],          match: /cannot reach phone server/i },
    { label: 'Registration timeout',      emit: ['registrationFailed', { cause: 'Request Timeout', response: { status_code: 408 } }], match: /phone server not responding/i },
    { label: 'Authentication failed',     emit: ['registrationFailed', { cause: 'Forbidden', response: { status_code: 403 } }],        match: /extension not authorized/i },
    { label: 'DNS resolution failed',     emit: ['registrationFailed', { cause: 'DNS lookup failed' }],                                match: /dns/i },
  ])('surfaces "$label" when JsSIP fires the matching event', async ({ emit, match }) => {
    const ua = installFakeJsSIP();
    const { result } = renderHook(() => useSoftphone(cfg));
    await waitFor(() => expect(ua.start).toHaveBeenCalled());
    act(() => (ua as any).emit(emit[0] as string, emit[1]));
    expect(result.current.sipError).toMatch(match);
  });
});

describe('Retrying… status during back-off', () => {
  it('shows "retrying" between attempts and clears on successful registration', async () => {
    vi.useFakeTimers();
    try {
      const ua = installFakeJsSIP();
      const { result } = renderHook(() => useSoftphone(cfg));
      await vi.waitFor(() => expect(ua.start).toHaveBeenCalled());

      // 1. Temporary timeout → successful WSS probe → bounded retry.
      await act(async () => { (ua as any).emit('registrationFailed', { cause: 'Request Timeout', response: { status_code: 408 } }); });
      expect(result.current.sipStatus).toBe('retrying');
      expect(result.current.sipError).toMatch(/phone server not responding/i);
      expect(result.current.retryAttempt).toBe(1);

      // 2. Advance the first 2 s back-off — UA restarts and reconnects.
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(result.current.sipStatus).toBe('connecting');
      expect(ua.start).toHaveBeenCalledTimes(2);

      // 3. PBX accepts → 'registered' and error cleared.
      act(() => (ua as any).emit('registered'));
      expect(result.current.sipStatus).toBe('registered');
      expect(result.current.sipError).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
