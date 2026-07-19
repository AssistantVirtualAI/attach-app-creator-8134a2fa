// Manages remote audio output routing (earpiece / speaker / bluetooth).
//
// Android WebView behaviour:
//   • The <audio> element defaults to AudioManager.STREAM_MUSIC which plays
//     through the SPEAKER. For VoIP we need STREAM_VOICE_CALL / earpiece.
//   • We achieve this by calling the native CapacitorPjsip.setAudioRoute()
//     bridge (which calls AudioManager.setMode(MODE_IN_COMMUNICATION) +
//     setSpeakerphoneOn(false)) as soon as the remote stream is attached.
//   • The speaker button calls setAudioRoute({ route: 'speaker' }) which
//     calls setSpeakerphoneOn(true).
//   • On web/desktop we fall back to HTMLMediaElement.setSinkId where
//     supported (Chrome desktop only).
//
// iOS: routed through AVAudioSession via CapacitorPjsip native bridge.

import { Capacitor } from '@capacitor/core';
import { CapacitorSipNative } from './nativeSipProvider';

export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth';

let audioEl: HTMLAudioElement | null = null;
// Default is ALWAYS earpiece — never speaker on call start.
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
 * Wire the remote WebRTC stream into the registered <audio> element.
 * Accepts either a RTCPeerConnection (JsSIP path — hooks ontrack) or a
 * MediaStream directly (Verto path — stream already resolved by the time
 * the 'media' event fires). Without this the remote party is not audible.
 *
 * IMPORTANT: after attaching the stream we immediately force the audio
 * route to EARPIECE so Android WebView does not default to the loudspeaker.
 */
export function attachRemoteStream(input: RTCPeerConnection | MediaStream) {
  if (input instanceof MediaStream) {
    // Verto path: stream is already available, wire it directly.
    if (!audioEl) {
      console.warn('[audioOutput] attachRemoteStream(stream): no audio element registered');
      return;
    }
    if (audioEl.srcObject !== input) {
      audioEl.srcObject = input;
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play().catch((e) => {
        console.warn('[audioOutput] play(stream) failed, retrying...', e);
        setTimeout(() => {
          audioEl?.play().catch((e2) => console.warn('[audioOutput] play retry failed', e2));
        }, 500);
      });
    }
    // Force earpiece immediately after stream is attached on Android.
    // Without this the WebView AudioManager stays in STREAM_MUSIC mode
    // and routes audio to the loudspeaker by default.
    _forceEarpiece();
    return;
  }
  // JsSIP path: RTCPeerConnection — hook ontrack for when tracks arrive.
  const pc = input;
  pc.ontrack = (event) => {
    if (!audioEl) {
      console.warn('[audioOutput] ontrack fired but no audio element registered');
      return;
    }
    const [stream] = event.streams;
    if (!stream) return;
    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play().catch((e) => {
        console.warn('[audioOutput] play failed, retrying...', e);
        setTimeout(() => {
          audioEl?.play().catch((e2) => console.warn('[audioOutput] play retry failed', e2));
        }, 500);
      });
    }
    // Force earpiece immediately after track arrives on Android.
    _forceEarpiece();
  };
}

/**
 * Internal: force audio to earpiece without changing the `route` state
 * variable (which is already 'earpiece' by default). This ensures the
 * Android AudioManager is in MODE_IN_COMMUNICATION from the moment the
 * remote stream arrives, regardless of what happened before.
 */
function _forceEarpiece() {
  if (!Capacitor.isNativePlatform()) return;
  // Already earpiece — still call native to ensure AudioManager mode is set.
  CapacitorSipNative.setAudioRoute({ route: 'earpiece' })
    .then((res) => {
      console.log('[audioOutput] _forceEarpiece result:', res?.route, res?.outputs);
      // Sync route state from native response
      const outs = (res?.outputs || '').toLowerCase();
      if (outs.includes('speaker')) route = 'speaker';
      else if (outs.includes('bluetooth')) route = 'bluetooth';
      else route = 'earpiece';
      emit();
    })
    .catch((e) => {
      console.warn('[audioOutput] _forceEarpiece failed (non-iOS stub):', e?.message || e);
      // On Android the native bridge is a no-op stub — fall back to
      // setSinkId('default') which at least avoids the media stream path.
      if (audioEl) {
        applySink(audioEl, 'earpiece').catch(() => {});
      }
    });
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
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CapacitorSipNative.setAudioRoute({ route: next });
        console.log('[audioOutput] setRoute', next, '→ native result:', res?.route, res?.outputs);
        // Sync route from native response (native knows the actual output)
        const outs = (res?.outputs || '').toLowerCase();
        if (outs.includes('speaker')) route = 'speaker';
        else if (outs.includes('bluetooth')) route = 'bluetooth';
        else route = 'earpiece';
      } catch (e) {
        // On Android the native bridge is a no-op stub for audio routing.
        // Fall back to setSinkId and update route state optimistically.
        console.warn('[audioOutput] native setAudioRoute failed, using setSinkId fallback:', e);
        route = next;
        if (audioEl) {
          try { await applySink(audioEl, route); } catch {}
        }
      }
    } else {
      // Web/desktop: use setSinkId
      route = next;
      if (audioEl) {
        try { await applySink(audioEl, route); } catch (e) {
          console.warn('[audioOutput] setSinkId failed', e);
        }
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
  // 'default' = earpiece/system default (not loudspeaker)
  // 'communications' = speakerphone / loudspeaker
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
