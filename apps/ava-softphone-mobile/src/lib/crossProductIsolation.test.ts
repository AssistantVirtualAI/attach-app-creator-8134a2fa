import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(), get: vi.fn(), set: vi.fn(), syncDeviceContacts: vi.fn(), hasConsent: vi.fn(),
  backendUrl: 'https://lemtel.assistantvirtualai.com',
}));
vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
}));
vi.mock('./mobileSupabase', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get, set: h.set } }));
vi.mock('./contacts', () => ({ syncDeviceContacts: h.syncDeviceContacts }));
vi.mock('./contactsConsent', () => ({ hasConsent: h.hasConsent }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
});

describe('le client Lemtel canonique n’appelle jamais les endpoints d’un autre produit', () => {
  it('affiche un numéro sans appeler un lookup historique', async () => {
    const { lookupCaller } = await import('./sip/callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result.found).toBe(false);
    expect(result.name).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('refuse la synchronisation de contacts avant tout accès aux contacts ou aux préférences héritées', async () => {
    const { getLastSync, maybeRunDeltaSync, runContactsSync } = await import('./contactsSync');
    expect(await getLastSync()).toEqual({ at: null, count: null });
    expect(await maybeRunDeltaSync()).toBeNull();
    expect(await runContactsSync({ force: true })).toMatchObject({
      ok: false, inserted: 0, total: 0, error: 'lemtel-contacts-service-not-configured',
    });
    expect(h.get).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.hasConsent).not.toHaveBeenCalled();
    expect(h.syncDeviceContacts).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
