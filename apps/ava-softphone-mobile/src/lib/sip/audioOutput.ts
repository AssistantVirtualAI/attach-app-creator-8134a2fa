// Manages remote audio output routing (earpiece / speaker / bluetooth).
// On Capacitor iOS we route through the native CapacitorPjsip plugin which
// drives AVAudioSession.overrideOutputAudioPort. On web we fall back to
// HTMLMediaElement.setSinkId where supported.

import { Capacitor } from '@capacitor/core';
import { CapacitorSipNative } from './nativeSipProvider';

export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth';

let audioEl: HTMLAudioElement | null = null;
let route: AudioRoute = 'earpiece';

let busy = false;
let bluetoothAvailable = false;
const listeners = new Set<(s: AudioState) => void>();

export type AudioState = {
  route: AudioRoute;
  busy: boolean;
  bluetoothAvailable: boolean;
};

function emit() {
  const s: AudioState = { route, busy, bluetoothAvailable };
  listeners.forEach((l) => l(s));
}

export function getAudioState(): AudioState {
  return { route, busy, bluetoothAvailable };
}

export function onAudioStateChange(cb: (s: AudioState) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function registerRemoteAudioElement(el: HTMLAudioElement | null) {
  audioEl = el;
  if (el) void applySink(el, route);
  void probeBluetooth();
}

/**
 * Wire the remote WebRTC stream from the RTCPeerConnection into the
 * registered <audio> element. Without this the remote party is not audible.
 */
export function attachRemoteStream(pc: RTCPeerConnection) {
  pc.ontrack = (event) => {
    if (!audioEl) {
      console.warn('[audioOutput] ontrack fired but no audio element registered');
      return;
    }
    const [stream] = event.streams;
    if (!stream) return;
    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
      audioEl.play().catch((e) => console.warn('[audioOutput] play failed', e));
    }
  };
}

// Legacy compatibility -------------------------------------------------------
export function isSpeakerOn() { return route === 'speaker'; }
export function onSpeakerChange(cb: (on: boolean) => void) {
  return onAudioStateChange((s) => cb(s.route === 'speaker'));
}
export async function toggleSpeaker(): Promise<boolean> {
  const next: AudioRoute = route === 'speaker' ? 'earpiece' : 'speaker';
  const ok = await setRoute(next);
  return ok && route === 'speaker';
}

// New API --------------------------------------------------------------------
export async function setRoute(next: AudioRoute): Promise<boolean> {
  if (busy) return false;
  busy = true; emit();
  let nativeOk = false;
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CapacitorSipNative.setAudioRoute({ route: next });
        nativeOk = !!res?.ok;
        const outs = (res?.outputs || '').toLowerCase();
        if (outs.includes('speaker')) route = 'speaker';
        else if (outs.includes('bluetooth')) route = 'bluetooth';
        else route = 'earpiece';
      } catch (e) {
        console.warn('[audioOutput] native setAudioRoute failed', e);
        throw e;
      }
    } else {
      route = next;
    }
    if (audioEl && !Capacitor.isNativePlatform()) {
      try { await applySink(audioEl, route); } catch (e) {
        if (!nativeOk) console.warn('[audioOutput] setSinkId failed', e);
      }
    }
    emit();
    return true;
  } finally {
    busy = false;
    emit();
  }
}

async function applySink(el: HTMLAudioElement, target: AudioRoute) {
  const anyEl = el as any;
  el.volume = 1.0;
  if (typeof anyEl.setSinkId !== 'function') return; // unsupported → silent skip
  const sinkId =
    target === 'speaker' ? 'communications' :
    target === 'bluetooth' ? 'communications' :
    'default';
  try { await anyEl.setSinkId(sinkId); } catch { /* native already routed */ }
}


async function probeBluetooth() {
  try {
    const md: any = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const devices: MediaDeviceInfo[] = await md.enumerateDevices();
    const next = devices.some((d) =>
      d.kind === 'audiooutput' && /bluetooth|airpods|bt|headset/i.test(d.label || '')
    );
    if (next !== bluetoothAvailable) {
      bluetoothAvailable = next;
      emit();
    }
  } catch { /* ignore */ }
}

if (typeof navigator !== 'undefined' && (navigator as any).mediaDevices?.addEventListener) {
  try {
    (navigator as any).mediaDevices.addEventListener('devicechange', probeBluetooth);
  } catch { /* ignore */ }
}
