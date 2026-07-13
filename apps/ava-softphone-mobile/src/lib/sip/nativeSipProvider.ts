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
// On Android the native class is intentionally NOT implemented — the app runs
// JsSIP inside the WebView on that platform (kept alive by SipForegroundService).
// Calling the real plugin on Android throws
//   "CapacitorPjsip plugin is not implemented on android"
// which used to bubble into sipError and show "SIP indisponible" in the UI.
// We therefore expose a no-op Proxy stub on every non-iOS platform so no caller
// (nativeSipState, deepLink, audioOutput, useSoftphoneNative, permissions…)
// can ever hit the missing bridge.
import { Capacitor as __Cap } from '@capacitor/core';
const __NATIVE_FLAG = ((import.meta as any).env?.VITE_NATIVE_SIP ?? '').toString() === 'true';
let __platform: string = 'web';
try { __platform = __Cap.getPlatform(); } catch { /* ssr / tests */ }
// NATIVE_SIP_ENABLED: iOS only — Android uses JsSIP over WSS (SipForegroundService keeps WebSocket alive).
// Setting this to true on Android routes through the no-op stub and leaves sipStatus stuck at 'idle'.
export const NATIVE_SIP_ENABLED = __platform === 'ios' && __NATIVE_FLAG !== false;

function makeNoopPlugin(): CapacitorSipPlugin {
  const noopHandle = { remove: async () => {} };
  const handler: ProxyHandler<any> = {
    get(_t, prop: string) {
      if (prop === 'addListener') return async () => noopHandle;
      if (prop === 'removeAllListeners') return async () => {};
      if (prop === 'getRtpStats') return async () => ({ running: false });
      if (prop === 'getAudioRoute') return async () => ({ outputs: [], availableInputs: [] });
      if (prop === 'setAudioRoute') return async () => ({ ok: false, route: 'auto', outputs: '' });
      if (prop === 'requestMicrophonePermission') return async () => ({ ok: false, granted: false, status: 'denied' as const, reason: 'unsupported-on-android' });
      if (prop === 'setLogLevel') return async () => ({ level: 0 });
      if (prop === 'playTestTone') return async () => ({ ok: false, micPeak: 0, route: 'auto' });
      if (prop === 'startRecord' || prop === 'stopRecord') return async () => ({ ok: false, recording: false });
      if (prop === 'transfer' || prop === 'park' || prop === 'addCall') return async () => ({ ok: false, target: '', code: '' });
      // Every other method (initAccount, disconnect, makeCall, hangup, answer,
      // setMute, setHold, sendDTMF, setLiveTranscriptionEnabled…) resolves
      // silently so caller `.catch()` handlers stay quiet.
      return async () => undefined;
    },
  };
  return new Proxy({}, handler) as CapacitorSipPlugin;
}

export const CapacitorSipNative: CapacitorSipPlugin =
  (__platform === 'ios' || __platform === 'android')
    ? registerPlugin<CapacitorSipPlugin>('CapacitorPjsip')
    : makeNoopPlugin();
export const CapacitorPjsip = CapacitorSipNative;

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
