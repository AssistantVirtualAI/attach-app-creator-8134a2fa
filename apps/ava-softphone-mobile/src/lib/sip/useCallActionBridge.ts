import { Capacitor } from '@capacitor/core';

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
// notification buttons (CallActionReceiver → CapacitorPjsip relay).
// Also listens to a mirrored `sip:callAction` window event so iOS CallKit
// callbacks can be surfaced the same way from CapacitorSip.
//
// IMPORTANT: We do NOT call registerPlugin() here because CapacitorPjsip is
// already registered in nativeSipProvider.ts. Calling registerPlugin() a second
// time causes the "already registered" error and can break the plugin instance.
// Instead we access the plugin via Capacitor.Plugins which always returns the
// existing registered instance.
export function useCallActionBridge(handlers: Handlers, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const cleanups: Array<() => void> = [];

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

    if (Capacitor.isNativePlatform?.()) {
      const platform = Capacitor.getPlatform();

      // Android: use the already-registered CapacitorPjsip instance.
      // Do NOT call registerPlugin() — it is already registered in nativeSipProvider.ts.
      if (platform === 'android') {
        try {
          const Plugin: any = (Capacitor as any).Plugins?.CapacitorPjsip;
          if (Plugin?.addListener) {
            const sub = Plugin.addListener('sipCallAction', (evt: { action: CallAction }) => {
              if (evt?.action) dispatch(evt.action);
            });
            if (sub && typeof sub.then === 'function') {
              sub.then((handle: any) => cleanups.push(() => handle?.remove?.()));
            } else if (sub?.remove) {
              cleanups.push(() => sub.remove());
            }
          }
        } catch (e) {
          console.warn('[useCallActionBridge] CapacitorPjsip listener failed:', e);
        }
      }

      // iOS only: CapacitorSip relays CallKit taps.
      if (platform === 'ios') {
        try {
          const { registerPlugin } = require('@capacitor/core');
          const IosPlugin: any = registerPlugin('CapacitorSip');
          const sub = IosPlugin.addListener?.('sipCallAction', (evt: { action: CallAction }) => {
            if (evt?.action) dispatch(evt.action);
          });
          if (sub && typeof sub.then === 'function') {
            sub.then((handle: any) => cleanups.push(() => handle?.remove?.()));
          } else if (sub?.remove) {
            cleanups.push(() => sub.remove());
          }
        } catch (e) {
          console.warn('[useCallActionBridge] CapacitorSip listener failed:', e);
        }
      }
    }

    // Web / cross-platform fallback — fires even if Capacitor plugins fail to load.
    const winHandler = (e: any) => {
      const action = e?.detail?.action as CallAction | undefined;
      if (action) dispatch(action);
    };
    window.addEventListener('sip:callAction', winHandler as EventListener);
    cleanups.push(() => window.removeEventListener('sip:callAction', winHandler as EventListener));

    return () => { cleanups.forEach((fn) => { try { fn(); } catch {} }); };
  }, [enabled, handlers.onAnswer, handlers.onDecline, handlers.onHangup, handlers.onHold, handlers.onResume, handlers.onMute]);
}
