import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getSession: vi.fn(), setSession: vi.fn(), refreshSession: vi.fn(), remove: vi.fn(),
}));
vi.mock('./backendOrigin', () => ({
  BACKEND_URL: 'https://api.lemtel.example',
  BACKEND_ANON_KEY: 'sb_publishable_test',
  BACKEND_STORAGE_SUFFIX: ':https%3A%2F%2Fapi.lemtel.example',
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: vi.fn(async ({ key }: { key: string }) => ({ value: h.values.get(key) ?? null })),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => { h.values.set(key, value); }),
  remove: h.remove,
} }));
vi.mock('./mobileSupabase', () => ({
  supabase: { auth: { getSession: h.getSession, setSession: h.setSession, refreshSession: h.refreshSession } },
  clearRecordingAudioCache: vi.fn(),
}));
vi.mock('./recordingCache', () => ({ clearRecordingCache: vi.fn() }));
vi.mock('./mobileApi', () => ({ setAuthToken: vi.fn() }));

import { Store, restoreSupabaseSession } from './creds';
const creds = { email: 'agent@example.test', extension: '1001', userId: 'u1',
  accessToken: 'user-jwt', refreshToken: 'refresh-jwt' };

beforeEach(() => {
  h.values.clear();
  h.getSession.mockReset(); h.setSession.mockReset(); h.refreshSession.mockReset(); h.remove.mockReset();
  h.remove.mockImplementation(async ({ key }: { key: string }) => { h.values.delete(key); });
});

describe('mobile self-hosted cutover is never a legacy-session restore', () => {
  it('does not import the historical native credentials into the new origin', async () => {
    h.values.set('lemtel.creds.v1', JSON.stringify(creds));
    h.values.set('lemtel-mobile-auth', 'historical-refresh-token');
    expect(await Store.get()).toBeNull();
    expect(h.values.has('lemtel.creds.v1')).toBe(false);
    expect(h.values.has('lemtel-mobile-auth')).toBe(false);
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('stamps new credentials with their origin and rejects a foreign stamp', async () => {
    await Store.set(creds);
    expect((await Store.get())?.backendOrigin).toBe('https://api.lemtel.example');
    const key = [...h.values.keys()].find((k) => k.startsWith('lemtel.creds.v1:'))!;
    h.values.set(key, JSON.stringify({ ...creds, backendOrigin: 'https://old.example.test' }));
    expect(await Store.get()).toBeNull();
    expect(await restoreSupabaseSession({ ...creds, backendOrigin: 'https://old.example.test' })).toBeNull();
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('refreshes an expired session before allowing its identity to be restored', async () => {
    h.getSession.mockResolvedValue({ data: { session: {
      ...creds, user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) - 1,
    } } });
    h.refreshSession.mockResolvedValue({ data: { session: {
      ...creds, user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) + 3600,
    } }, error: null });
    expect((await restoreSupabaseSession({ ...creds, backendOrigin: 'https://api.lemtel.example' }))?.user.id).toBe('u1');
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed when refresh rejects an expired session', async () => {
    h.getSession.mockResolvedValue({ data: { session: {
      ...creds, user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) - 1,
    } } });
    h.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('expired') });
    expect(await restoreSupabaseSession({ ...creds, backendOrigin: 'https://api.lemtel.example' })).toBeNull();
  });
});
