/**
 * Lemtel call notifications (phase 3.3): registers this install's push channel with the Lemtel server so an
 * incoming call can wake the app — iOS: PushKit VoIP token (CallKit rings), Android: FCM token (high-priority
 * data message → full-screen incoming call). The server binds the device to the signed-in user only.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BACKEND_URL } from './backendOrigin';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type PjsipPush = { getVoipPushToken(): Promise<{ token: string; environment: 'production' | 'sandbox' }>; addListener(e: 'voipPushToken', cb: (d: { token: string }) => void): Promise<{ remove: () => void }> };
const DEVICE_KEY = 'lemtel.pushDeviceId';
const PENDING_KEY = 'lemtel.pendingIncomingPush';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function prefs() { return (await import('@capacitor/preferences')).Preferences; }

/** Stable random id for this install (not a hardware identifier). */
export async function pushDeviceId(): Promise<string> {
  const P = await prefs();
  const { value } = await P.get({ key: DEVICE_KEY });
  if (value && UUID_RE.test(value)) return value;
  const id = crypto.randomUUID();
  await P.set({ key: DEVICE_KEY, value: id });
  return id;
}

export async function postPushRegistration(args: { accessToken: string; publishableKey: string; body: Record<string, unknown>; fetcher?: FetchLike }): Promise<boolean> {
  try {
    const res = await (args.fetcher ?? fetch)(`${BACKEND_URL}/functions/v1/lemtel-push-register`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: args.publishableKey, Authorization: `Bearer ${args.accessToken}` },
      body: JSON.stringify(args.body),
    });
    return res.ok;
  } catch { return false; }
}

/** Registers the platform's call-push channel; safe to call at every start (idempotent server-side). */
export async function registerLemtelCallPush(args: { accessToken: string; publishableKey: string; appVersion?: string; fcmToken?: string; fetcher?: FetchLike }): Promise<'registered' | 'unavailable' | 'failed'> {
  if (!Capacitor.isNativePlatform() || !args.accessToken) return 'unavailable';
  const deviceId = await pushDeviceId();
  const appVersion = args.appVersion && /^[0-9A-Za-z.+-]{1,32}$/.test(args.appVersion) ? args.appVersion : undefined;
  const platform = Capacitor.getPlatform();
  if (platform === 'android') {
    if (!args.fcmToken) return 'unavailable';
    return (await postPushRegistration({ ...args, body: { action: 'register', deviceId, platform: 'android', channel: 'fcm', token: args.fcmToken, ...(appVersion ? { appVersion } : {}) } })) ? 'registered' : 'failed';
  }
  if (platform === 'ios') {
    const plugin = registerPlugin<PjsipPush>('CapacitorPjsip');
    let voip: { token: string; environment: 'production' | 'sandbox' } | null = null;
    try { voip = await plugin.getVoipPushToken(); } catch { voip = null; }
    if (!voip?.token || !/^[0-9a-f]{64,200}$/i.test(voip.token)) return 'unavailable';
    return (await postPushRegistration({ ...args, body: { action: 'register', deviceId, platform: 'ios', channel: 'apns_voip', token: voip.token, apnsEnvironment: voip.environment, ...(appVersion ? { appVersion } : {}) } })) ? 'registered' : 'failed';
  }
  return 'unavailable';
}

/** Re-registers whenever iOS rotates the VoIP token. */
export async function watchVoipToken(onToken: () => void): Promise<() => void> {
  if (Capacitor.getPlatform() !== 'ios') return () => {};
  try { const h = await registerPlugin<PjsipPush>('CapacitorPjsip').addListener('voipPushToken', () => onToken()); return () => h.remove(); }
  catch { return () => {}; }
}

/** On sign-out: this install stops ringing for the account. */
export async function unregisterLemtelCallPush(args: { accessToken: string; publishableKey: string; fetcher?: FetchLike }): Promise<void> {
  if (!Capacitor.isNativePlatform() || !args.accessToken) return;
  await postPushRegistration({ ...args, body: { action: 'unregister', deviceId: await pushDeviceId() } });
}

export type PendingIncomingPush = { callRef: string; fromNumber: string; fromName: string; expiresAt: number };
/** Android: the native push service leaves the woken call here; consumed once, ignored after expiry. */
export async function consumePendingIncomingPush(now = Date.now()): Promise<PendingIncomingPush | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const P = await prefs();
  const { value } = await P.get({ key: PENDING_KEY });
  if (!value) return null;
  await P.remove({ key: PENDING_KEY });
  try {
    const p = JSON.parse(value) as Partial<PendingIncomingPush>;
    if (typeof p.callRef !== 'string' || typeof p.expiresAt !== 'number' || p.expiresAt < now) return null;
    return { callRef: p.callRef, fromNumber: String(p.fromNumber ?? ''), fromName: String(p.fromName ?? ''), expiresAt: p.expiresAt };
  } catch { return null; }
}
