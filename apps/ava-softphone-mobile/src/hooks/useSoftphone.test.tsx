import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSoftphone } from './useSoftphone';
import { fetchIceServers } from '../lib/sip/iceServers';
import { probeWss } from '../lib/sip/sipPersistence';

vi.mock('../lib/sip/iceServers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/sip/iceServers')>(),
  fetchIceServers: vi.fn(async () => []),
}));
vi.mock('../lib/sip/sipPersistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/sip/sipPersistence')>(),
  probeWss: vi.fn(async () => ({ ok: true, ms: 1 })),
}));

type Handler = (...args: any[]) => void;

function makeFakeSession(direction: 'incoming' | 'outgoing' = 'incoming', user = '5145551234') {
  const handlers: Record<string, Handler[]> = {};
  return {
    direction,
    remote_identity: { uri: { user } },
    on(evt: string, cb: Handler) {
      (handlers[evt] = handlers[evt] || []).push(cb);
    },
    emit(evt: string, ...args: any[]) {
      (handlers[evt] || []).forEach((h) => h(...args));
    },
    terminate: vi.fn(),
    answer: vi.fn(),
  };
}

function installFakeJsSIP() {
  const uaHandlers: Record<string, Handler[]> = {};
  const ua = {
    on: vi.fn((evt: string, cb: Handler) => {
      (uaHandlers[evt] = uaHandlers[evt] || []).push(cb);
    }),
    start: vi.fn(),
    stop: vi.fn(),
    register: vi.fn(),
    call: vi.fn(),
    emit: (evt: string, ...args: any[]) =>
      (uaHandlers[evt] || []).forEach((h) => h(...args)),
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
  domain: 'lemtel.tel',
  wssUrl: 'wss://sip.example.com:7443',
  displayName: 'Test',
};

describe('useSoftphone', () => {
  beforeEach(() => {
    delete (window as any).JsSIP;
    vi.mocked(fetchIceServers).mockReset().mockResolvedValue([]);
    vi.mocked(probeWss).mockReset().mockResolvedValue({ ok: true, ms: 1 });
  });
  afterEach(() => {
    delete (window as any).JsSIP;
  });

  it.skip('reports error when JsSIP never loads (short timeout)', async () => {
    const { result } = renderHook(() => useSoftphone(cfg, { jsSipTimeoutMs: 50 }));
    expect(result.current.sipStatus).toBe('connecting');
    // After the load failure the hook surfaces the error message and
    // schedules a back-off retry, so status becomes 'retrying'.
    await waitFor(() => expect(result.current.sipStatus).toBe('retrying'), { timeout: 1500 });
    expect(result.current.sipError).toMatch(/library failed to load/i);
  });

  it('transitions to registered on UA "registered" event', async () => {
    const ua = installFakeJsSIP();
    const { result } = renderHook(() => useSoftphone(cfg));
    await waitFor(() => expect(ua.start).toHaveBeenCalled());
    act(() => ua.emit('registered'));
    expect(result.current.sipStatus).toBe('registered');
    expect(result.current.sipError).toBe('');
  });

  it('blocks automatic retry on a forbidden extension until an explicit reconnect', async () => {
    const ua = installFakeJsSIP();
    const { result } = renderHook(() => useSoftphone(cfg));
    await waitFor(() => expect(ua.start).toHaveBeenCalled());
    act(() => ua.emit('registrationFailed', { cause: 'Forbidden', response: { status_code: 403 } }));
    expect(result.current.sipStatus).toBe('error');
    expect(result.current.sipError).toBe('Extension not authorized');
    expect(result.current.nextRetryAt).toBeNull();
    expect(result.current.retryAttempt).toBe(0);
    expect(probeWss).not.toHaveBeenCalled();

    act(() => result.current.reconnect());
    await waitFor(() => expect(ua.start).toHaveBeenCalledTimes(2));
    act(() => ua.emit('registered'));
    expect(result.current.sipStatus).toBe('registered');
    expect(result.current.sipError).toBe('');
  });

  it('blocks a Forbidden cause even if the PBX omits its SIP status code', async () => {
    const ua = installFakeJsSIP();
    const { result } = renderHook(() => useSoftphone(cfg));
    await waitFor(() => expect(ua.start).toHaveBeenCalled());
    act(() => ua.emit('registrationFailed', { cause: 'Forbidden' }));
    expect(result.current.sipStatus).toBe('error');
    expect(result.current.sipError).toBe('Extension not authorized');
    expect(result.current.nextRetryAt).toBeNull();
    expect(result.current.retryAttempt).toBe(0);
    expect(probeWss).not.toHaveBeenCalled();
  });

  it('cancels a pending re-REGISTER and ignores network recovery after auth rejection', async () => {
    vi.useFakeTimers();
    try {
      const ua = installFakeJsSIP();
      const { result } = renderHook(() => useSoftphone(cfg));
      await vi.waitFor(() => expect(ua.start).toHaveBeenCalledTimes(1));
      act(() => ua.emit('registered'));
      act(() => ua.emit('unregistered', { cause: 'binding expired' })); // arms a timer
      act(() => ua.emit('registrationFailed', { cause: 'Forbidden', response: { status_code: 403 } }));
      act(() => ua.emit('unregistered', { cause: 'Forbidden' })); // JsSIP can emit this after failure
      act(() => window.dispatchEvent(new Event('online')));
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(result.current.sipStatus).toBe('error');
      expect(ua.register).not.toHaveBeenCalled();
      expect(ua.start).toHaveBeenCalledTimes(1);
      expect(probeWss).not.toHaveBeenCalled();

      act(() => result.current.reconnect());
      await vi.waitFor(() => expect(ua.start).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles incoming call: ringing -> active -> ended', async () => {
    const ua = installFakeJsSIP();
    const { result } = renderHook(() => useSoftphone(cfg));
    await waitFor(() => expect(ua.start).toHaveBeenCalled());

    const session = makeFakeSession('incoming', '5145559999');
    act(() => ua.emit('newRTCSession', { session }));
    expect(result.current.callState).toBe('ringing-in');
    expect(result.current.activeCallNumber).toBe('5145559999');

    act(() => session.emit('confirmed'));
    expect(result.current.callState).toBe('active');

    act(() => session.emit('ended'));
    expect(result.current.callState).toBe('ended');
    // Transition back to idle happens after a 2s setTimeout; assert it eventually clears.
    await waitFor(() => expect(result.current.callState).toBe('idle'), { timeout: 3000 });
    expect(result.current.activeCallNumber).toBe('');
  });

  it('does not place A’s delayed INVITE on B’s UA after an extension change', async () => {
    const uaA = installFakeJsSIP();
    const bHandlers: Record<string, Handler[]> = {};
    const uaB = {
      ...uaA, start: vi.fn(), stop: vi.fn(), call: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => { (bHandlers[event] ||= []).push(handler); }),
      emit: (event: string, ...args: any[]) => (bHandlers[event] || []).forEach((handler) => handler(...args)),
    };
    vi.mocked((window as any).JsSIP.UA)
      .mockImplementationOnce(() => uaA)
      .mockImplementationOnce(() => uaB);
    const { result, rerender } = renderHook(({ sip }) => useSoftphone(sip), { initialProps: { sip: cfg } });
    await waitFor(() => expect(uaA.start).toHaveBeenCalled());
    act(() => uaA.emit('registered'));

    let finishIce!: (servers: RTCIceServer[]) => void;
    vi.mocked(fetchIceServers).mockImplementationOnce(() => new Promise((resolve) => { finishIce = resolve; }));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.call('15145550100') as Promise<boolean>; });
    await waitFor(() => expect(fetchIceServers).toHaveBeenCalledTimes(1));
    rerender({ sip: { ...cfg, extension: '301' } });
    await waitFor(() => expect(uaB.start).toHaveBeenCalled());
    expect(result.current.callState).toBe('idle');
    expect(result.current.activeCallNumber).toBe('');
    act(() => uaA.emit('registered')); // event from the detached socket
    expect(result.current.sipStatus).toBe('connecting');

    await act(async () => { finishIce([]); expect(await pending).toBe(false); });
    expect(uaA.call).not.toHaveBeenCalled();
    expect(uaB.call).not.toHaveBeenCalled();
    expect(result.current.callState).toBe('idle');
    expect(result.current.activeCallNumber).toBe('');
    act(() => uaB.emit('registered'));
    act(() => uaA.emit('disconnected', { error: true, reason: 'late close' }));
    expect(result.current.sipStatus).toBe('registered');
    expect(probeWss).not.toHaveBeenCalled();
  });
});
