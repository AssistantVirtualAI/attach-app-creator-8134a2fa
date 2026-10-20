import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ platform: 'android', store: new Map<string, string>(), voip: { token: 'a'.repeat(64), environment: 'production' as const } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.platform !== 'web', getPlatform: () => env.platform },
  registerPlugin: () => ({ getVoipPushToken: async () => env.voip, addListener: async () => ({ remove: () => {} }) }),
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: env.store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { env.store.set(key, value); },
    remove: async ({ key }: { key: string }) => { env.store.delete(key); },
  },
}));
import { consumePendingIncomingPush, pushDeviceId, registerLemtelCallPush, unregisterLemtelCallPush } from './lemtelCallPush';

const okFetch = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
beforeEach(() => { env.store.clear(); env.platform = 'android'; });

describe('Lemtel call push registration (3.3)', () => {
  it('keeps one stable random device id per install', async () => {
    const a = await pushDeviceId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await pushDeviceId()).toBe(a);
  });

  it('Android registers its FCM token; iOS its PushKit VoIP token with the APNs environment', async () => {
    const f = okFetch();
    expect(await registerLemtelCallPush({ accessToken: 'jwt', publishableKey: 'pk', fcmToken: 'fcm_' + 'x'.repeat(40), fetcher: f })).toBe('registered');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/lemtel-push-register$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'register', platform: 'android', channel: 'fcm' });
    env.platform = 'ios';
    const g = okFetch();
    expect(await registerLemtelCallPush({ accessToken: 'jwt', publishableKey: 'pk', fetcher: g })).toBe('registered');
    expect(JSON.parse(String((g.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ platform: 'ios', channel: 'apns_voip', token: 'a'.repeat(64), apnsEnvironment: 'production' });
  });

  it('does nothing without a token or a session; reports a server refusal', async () => {
    expect(await registerLemtelCallPush({ accessToken: 'jwt', publishableKey: 'pk' })).toBe('unavailable');
    expect(await registerLemtelCallPush({ accessToken: '', publishableKey: 'pk', fcmToken: 'x'.repeat(40) })).toBe('unavailable');
    const f = vi.fn(async () => new Response('{"error":"no_active_organization"}', { status: 403 }));
    expect(await registerLemtelCallPush({ accessToken: 'jwt', publishableKey: 'pk', fcmToken: 'x'.repeat(40), fetcher: f })).toBe('failed');
  });

  it('sign-out unregisters this install', async () => {
    const f = okFetch();
    await unregisterLemtelCallPush({ accessToken: 'jwt', publishableKey: 'pk', fetcher: f });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'unregister', deviceId: await pushDeviceId() });
  });

  it('a pending pushed call is consumed once and ignored after expiry', async () => {
    env.store.set('lemtel.pendingIncomingPush', JSON.stringify({ callRef: 'abc', fromNumber: '514', fromName: 'Ana', expiresAt: 2_000 }));
    expect(await consumePendingIncomingPush(1_000)).toEqual({ callRef: 'abc', fromNumber: '514', fromName: 'Ana', expiresAt: 2_000 });
    expect(await consumePendingIncomingPush(1_000)).toBeNull();
    env.store.set('lemtel.pendingIncomingPush', JSON.stringify({ callRef: 'abc', expiresAt: 500 }));
    expect(await consumePendingIncomingPush(1_000)).toBeNull();
  });
});
