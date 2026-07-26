/**
 * androidCallNotif.ts
 *
 * Lightweight helpers to trigger / dismiss the native Android incoming-call
 * notification (fullscreen intent + ringtone) from the JsSIP path.
 *
 * Uses Capacitor.Plugins to access the already-registered CapacitorPjsip plugin
 * without calling registerPlugin() again (which would throw "already registered").
 *
 * The real Kotlin implementation lives in CapacitorPjsip.kt —
 * showIncomingCallNotif / dismissIncomingCallNotif methods.
 */

import { Capacitor } from '@capacitor/core';

function getPlugin(): any {
  try {
    // Access the already-registered plugin via Capacitor.Plugins (no re-registration)
    return (Capacitor as any).Plugins?.CapacitorPjsip ?? null;
  } catch {
    return null;
  }
}

export async function showAndroidIncomingCallNotif(callerNumber: string, callerName: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const plugin = getPlugin();
    await plugin?.showIncomingCallNotif?.({ callerNumber, callerName });
  } catch (e) {
    console.warn('[androidCallNotif] showIncomingCallNotif failed', e);
  }
}

export async function dismissAndroidIncomingCallNotif(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const plugin = getPlugin();
    await plugin?.dismissIncomingCallNotif?.();
  } catch (e) {
    console.warn('[androidCallNotif] dismissIncomingCallNotif failed', e);
  }
}
