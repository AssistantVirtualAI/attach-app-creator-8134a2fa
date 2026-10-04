/**
 * Tests the TURN probe diagnostics and safe STUN-only bootstrap.
 *
 * Strategy: mock global `RTCPeerConnection` with a stub that NEVER emits a
 * relay candidate. Explicit diagnostics still probe; bootstrap no longer
 * waits for TURN when build-time config contains only public STUN servers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Listener = (ev: any) => void;

function makeStubPC(opts: { emitRelay?: boolean }) {
  const listeners: Record<string, Listener[]> = {};
  let gatherState: RTCIceGatheringState = 'new';
  const pc: any = {
    iceGatheringState: gatherState,
    addEventListener(name: string, fn: Listener) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name: string, fn: Listener) {
      listeners[name] = (listeners[name] || []).filter((l) => l !== fn);
    },
    addTransceiver: vi.fn(),
    close: vi.fn(),
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\n' }),
    setLocalDescription: vi.fn().mockImplementation(async () => {
      // Simulate async gathering after setLocalDescription resolves.
      queueMicrotask(() => {
        if (opts.emitRelay) {
          const candidate = { type: 'relay', candidate: 'candidate:1 1 udp 9 1.2.3.4 5 typ relay' };
          (listeners['icecandidate'] || []).forEach((l) => l({ candidate }));
        }
        // Either way, eventually complete gathering (after the probe timeout).
      });
    }),
  };
  Object.defineProperty(pc, 'iceGatheringState', {
    get() { return gatherState; },
    set(v) { gatherState = v; },
  });
  return pc;
}

describe('rtcConfig — TURN probe fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    // @ts-ignore
    delete (globalThis as any).RTCPeerConnection;
  });

  it('returns provider=fallback when neither probe yields a relay within timeout', async () => {
    (globalThis as any).RTCPeerConnection = vi.fn(() => makeStubPC({ emitRelay: false }));
    const mod = await import('./rtcConfig');
    mod.__resetActivePcConfig();

    const promise = mod.probeTurnEndpoints(5000);
    // Drain the two sequential 5s timeouts (metered, then fallback).
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    const res = await promise;

    expect(res.provider).toBe('fallback');
    expect(res.relayFound).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('bootstrap uses STUN without probing an unavailable embedded TURN service', async () => {
    (globalThis as any).RTCPeerConnection = vi.fn(() => makeStubPC({ emitRelay: false }));
    const mod = await import('./rtcConfig');
    mod.__resetActivePcConfig();

    const events: any[] = [];
    const off = mod.onIceDiagnostic((e) => events.push(e));

    const cfg = await mod.ensureActivePcConfig();
    off();

    expect(mod.getActiveTurnProvider()).toBe('fallback');
    expect(cfg.iceServers).toBe(mod.FALLBACK_ICE_SERVERS);
    expect((globalThis as any).RTCPeerConnection).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === 'probe-started')).toBe(false);
    expect(events.some((e) => e.kind === 'pc-config' && e.provider === 'fallback')).toBe(true);
  });

  it('telemetry sink reports provider_selected without pretending relay was found', async () => {
    (globalThis as any).RTCPeerConnection = vi.fn(() => makeStubPC({ emitRelay: false }));
    const mod = await import('./rtcConfig');
    mod.__resetActivePcConfig();

    const calls: any[] = [];
    mod.setTelemetrySink((e) => calls.push(e));

    await mod.ensureActivePcConfig();
    mod.setTelemetrySink(null);

    const names = calls.map((c) => c.name);
    expect(names).not.toContain('sip.turn.probe_started');
    expect(names).not.toContain('sip.turn.probe_result');
    expect(names).toContain('sip.turn.provider_selected');
    expect(calls.find((c) => c.name === 'sip.turn.provider_selected')?.meta?.provider).toBe('fallback');
  });
});
