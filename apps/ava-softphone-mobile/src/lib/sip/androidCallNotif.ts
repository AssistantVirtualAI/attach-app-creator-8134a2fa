/**
 * androidCallNotif.ts
 *
 * Lightweight helpers to trigger / dismiss the native Android incoming-call
 * notification (fullscreen intent + ringtone) from the JsSIP path.
 *
 * Uses the AndroidSipServicePlugin instance already registered in
 * nativeSipProvider.ts — no registerPlugin() call here to avoid
 * "already registered" errors.
 *
 * The real Kotlin implementation lives in CapacitorPjsip.kt —
 * showIncomingCallNotif / dismissIncomingCallNotif methods.
 */

import { Capacitor } from '@capacitor/core';

// Lazy-import to avoid circular dependency at module load time.
// nativeSipProvider.ts registers CapacitorPjsip once; we reuse that instance.
async function getPlugin(): Promise<any> {
  try {
    const mod = await import('./nativeSipProvider');
    // AndroidSipServicePlugin is the registered CapacitorPjsip bridge on Android.
    return (mod as any).AndroidSipServicePlugin ?? null;
  } catch {
    return null;
  }
}

export async function showAndroidIncomingCallNotif(callerNumber: string, callerName: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const plugin = await getPlugin();
    await plugin?.showIncomingCallNotif?.({ callerNumber, callerName });
  } catch (e) {
    console.warn('[androidCallNotif] showIncomingCallNotif failed', e);
  }
}

export async function dismissAndroidIncomingCallNotif(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const plugin = await getPlugin();
    await plugin?.dismissIncomingCallNotif?.();
  } catch (e) {
    console.warn('[androidCallNotif] dismissIncomingCallNotif failed', e);
  }
}
