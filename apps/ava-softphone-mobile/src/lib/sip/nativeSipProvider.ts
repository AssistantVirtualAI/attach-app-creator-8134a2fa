import { registerPlugin } from '@capacitor/core';

export type CapacitorSipLogLevel = 0 | 1 | 2 | 3 | 4 | 5;
// 0=off 1=error 2=warn 3=info 4=debug 5=verbose (full SIP frames)

export interface CapacitorSipPlugin {
  initAccount(options: {
    extension: string;
    domain: string;
    password: string;
    host?: string;
    server?: string;
    port?: number;
    transport?: string;
    username?: string;
    wssUrl?: string; // legacy, ignored by native TLS plugin
    logLevel?: CapacitorSipLogLevel;
  }): Promise<void>;
  disconnect(): Promise<void>;
  makeCall(options: { number: string }): Promise<void>;
  hangup(): Promise<void>;
  answer(): Promise<void>;
  setMute(options: { muted: boolean }): Promise<void>;
  setHold(options: { held?: boolean; onHold?: boolean }): Promise<void>;
  sendDTMF(options: { digits?: string; digit?: string }): Promise<void>;
  setLogLevel(options: { level: CapacitorSipLogLevel }): Promise<{ level: number }>;
  requestMicrophonePermission(): Promise<{ ok: boolean; granted: boolean; status: 'granted' | 'denied'; reason?: string }>;
  setAudioRoute(options: { route: 'auto' | 'speaker' | 'earpiece' | 'bluetooth' }): Promise<{ ok: boolean; route: string; outputs: string }>;
  getAudioRoute(): Promise<{ outputs: Array<{ portType: string; portName: string }>; availableInputs: Array<{ portType: string; portName: string }> }>;
  playTestTone(options?: { seconds?: number; frequency?: number }): Promise<{ ok: boolean; micPeak: number; route: string }>;
  getRtpStats(): Promise<{
    running: boolean;
    localIp?: string;
    localPort?: number;
    remoteIp?: string;
    remotePort?: number;
    txPackets?: number;
    rxPackets?: number;
    txBytes?: number;
    rxBytes?: number;
    lastSeq?: number;
    seqOut?: number;
    micPeak?: number;
    rxPeak?: number;
    uptimeMs?: number;
    route?: string;
    tapFormat?: string;
    converterFormat?: string;
    converterRebuilds?: number;
    convertErrors?: number;
    lastConvertError?: string;
    audioBackend?: string;
    inputCallbacks?: number;
    renderCallbacks?: number;
    inputFrames?: number;
    renderFrames?: number;
    sessionState?: string;
    lastEngineError?: string;
  }>;
  startRecord(): Promise<{ ok: boolean; recording: boolean }>;
  stopRecord(): Promise<{ ok: boolean; recording: boolean }>;
  transfer(options: { target: string }): Promise<{ ok: boolean; target: string }>;
  park(options?: { code?: string }): Promise<{ ok: boolean; code: string }>;
  addCall(options: { target: string }): Promise<{ ok: boolean; target: string }>;
  // Live transcription removed — kept as deprecated no-op signature so
  // legacy callers don't break the type check. Will be deleted in a follow-up.
  setLiveTranscriptionEnabled?(options: { enabled: boolean }): Promise<{ ok: boolean; enabled: boolean }>;
  addListener(event: string, callback: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
}

// IMPORTANT: the iOS bridge exports the plugin under the name `CapacitorPjsip`
// (see CAP_PLUGIN(CapacitorPjsip, "CapacitorPjsip", ...) in CapacitorSip.m).
// Registering a different JS name made every method call resolve to the
// web-fallback no-op and left the UI stuck on "connecting" forever.
export const CapacitorSipNative = registerPlugin<CapacitorSipPlugin>('CapacitorPjsip');
export const CapacitorPjsip = CapacitorSipNative;

// Native PJSIP is wired on iOS and Android. Android must not fall back to
// JsSIP/WebView because backgrounded WebSockets are killed by the OS.
import { Capacitor as __Cap } from '@capacitor/core';
const __NATIVE_FLAG = ((import.meta as any).env?.VITE_NATIVE_SIP ?? '').toString() === 'true';
let __platform: string = 'web';
try { __platform = __Cap.getPlatform(); } catch { /* ssr / tests */ }
export const NATIVE_SIP_ENABLED = __platform === 'android' || (__NATIVE_FLAG && __platform === 'ios');

/**
 * Subscribe to a native SIP event. Returns a cleanup function.
 * Maps legacy event names (registered / registrationFailed) onto the unified
 * `registration` event emitted by the new TLS plugin.
 */
export async function onNativeSipEvent(
  event: 'registered' | 'registrationFailed' | 'callReceived' | 'callStateChanged' | 'callEnded' | 'log' | 'muteChanged' | 'holdChanged',
  cb: (data: any) => void,
): Promise<() => void> {
  if (event === 'registered' || event === 'registrationFailed') {
    const handle = await CapacitorSipNative.addListener('registration', (d: any) => {
      if (event === 'registered' && d?.status === 'registered') cb(d);
      if (event === 'registrationFailed' && d?.status === 'error') cb(d);
    });
    return () => { handle.remove().catch(() => {}); };
  }
  const handle = await CapacitorSipNative.addListener(event, cb);
  return () => { handle.remove().catch(() => {}); };
}

/**
 * Convenience: forward native SIP log events to the JS console. Call once at app
 * boot when you need verbose on-device diagnostics. Returns a cleanup function.
 *
 * Example:
 *   await CapacitorSipNative.setLogLevel({ level: 5 });
 *   const stop = await attachNativeSipLogger();
 */
export async function attachNativeSipLogger(): Promise<() => void> {
  return onNativeSipEvent('log', (e: any) => {
    const tag = `[CapacitorSip][${e?.tag ?? '?'}][${e?.category ?? '?'}]`;
    const lvl = e?.level ?? 3;
    const fn = lvl <= 1 ? 'error' : lvl === 2 ? 'warn' : lvl >= 4 ? 'debug' : 'info';
    // eslint-disable-next-line no-console
    (console as any)[fn](tag, e?.message);
  });
}
