import { useEffect } from 'react';
import { registerPlugin, Capacitor } from '@capacitor/core';

type CallAction = 'answer' | 'decline' | 'hangup' | 'hold' | 'resume' | 'mute';

interface Handlers {
  onAnswer?: () => void;
  onDecline?: () => void;
  onHangup?: () => void;
  onHold?: () => void;
  onResume?: () => void;
  onMute?: () => void;
}

// Registers a bridge to the native `sipCallAction` event fired by the Android
// notification buttons (CallActionReceiver). Also listens to a mirrored
// `sip:callAction` window event so iOS CallKit callbacks can be surfaced the
// same way from CapacitorSip.
export function useCallActionBridge(handlers: Handlers, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    let cleanups: Array<() => void> = [];

    const dispatch = (action: CallAction) => {
      switch (action) {
        case 'answer':  handlers.onAnswer?.(); break;
        case 'decline': (handlers.onDecline || handlers.onHangup)?.(); break;
        case 'hangup':  (handlers.onHangup || handlers.onDecline)?.(); break;
        case 'hold':    handlers.onHold?.(); break;
        case 'resume':  handlers.onResume?.(); break;
        case 'mute':    handlers.onMute?.(); break;
      }
    };

    // Android: CapacitorPjsip plugin event.
    if (Capacitor.isNativePlatform?.()) {
      try {
        const Plugin: any = registerPlugin('CapacitorPjsip');
        const sub = Plugin.addListener?.('sipCallAction', (evt: { action: CallAction }) => {
          if (evt?.action) dispatch(evt.action);
        });
        if (sub && typeof sub.then === 'function') {
          sub.then((handle: any) => cleanups.push(() => handle?.remove?.()));
        } else if (sub?.remove) {
          cleanups.push(() => sub.remove());
        }
      } catch {}

      // iOS: CapacitorSip may relay CallKit taps as the same event.
      try {
        const IosPlugin: any = registerPlugin('CapacitorSip');
        const sub = IosPlugin.addListener?.('sipCallAction', (evt: { action: CallAction }) => {
          if (evt?.action) dispatch(evt.action);
        });
        if (sub && typeof sub.then === 'function') {
          sub.then((handle: any) => cleanups.push(() => handle?.remove?.()));
        } else if (sub?.remove) {
          cleanups.push(() => sub.remove());
        }
      } catch {}
    }

    // Web / cross-platform fallback: a plain window event.
    const winHandler = (e: any) => {
      const action = e?.detail?.action as CallAction | undefined;
      if (action) dispatch(action);
    };
    window.addEventListener('sip:callAction', winHandler as EventListener);
    cleanups.push(() => window.removeEventListener('sip:callAction', winHandler as EventListener));

    return () => { cleanups.forEach((fn) => { try { fn(); } catch {} }); };
  }, [enabled, handlers.onAnswer, handlers.onDecline, handlers.onHangup, handlers.onHold, handlers.onResume, handlers.onMute]);
}
