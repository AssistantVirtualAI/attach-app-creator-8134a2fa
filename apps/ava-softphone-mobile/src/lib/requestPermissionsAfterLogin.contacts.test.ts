import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://api.lemtel.example',
  get: vi.fn(), set: vi.fn(), hasConsent: vi.fn(), requestContacts: vi.fn(),
  addListener: vi.fn(), checkPush: vi.fn(), requestPush: vi.fn(), register: vi.fn(),
}));
vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('./contactsConsent', () => ({ hasConsent: h.hasConsent }));
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
} }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get, set: h.set } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: () => Promise.resolve({ id: 'test', name: 'Lemtel' }) } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: h.addListener, checkPermissions: h.checkPush,
  requestPermissions: h.requestPush, register: h.register,
} }));
vi.mock('@capacitor-community/contacts', () => ({ Contacts: { requestPermissions: h.requestContacts } }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  h.backendUrl = 'https://api.lemtel.example';
  h.get.mockResolvedValue({ value: null });
  h.set.mockResolvedValue(undefined);
  h.hasConsent.mockResolvedValue(true); // ancien consentement accordé
  h.checkPush.mockResolvedValue({ receive: 'denied' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('première connexion iOS : permission Contacts', () => {
  it('ne charge pas le plugin du carnet sur un nouvel émetteur malgré un consentement historique', async () => {
    const { requestPermissionsAfterLogin } = await import('./requestPermissionsAfterLogin');
    await requestPermissionsAfterLogin();
    expect(h.hasConsent).not.toHaveBeenCalled();
    expect(h.requestContacts).not.toHaveBeenCalled();
  });

  it('ne demande pas Contacts à une installation historique sans consentement explicite', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    h.hasConsent.mockResolvedValue(false);
    vi.resetModules();
    const { requestPermissionsAfterLogin } = await import('./requestPermissionsAfterLogin');
    await requestPermissionsAfterLogin();
    expect(h.hasConsent).toHaveBeenCalled();
    expect(h.requestContacts).not.toHaveBeenCalled();
  });

  it('conserve le chemin historique iOS après consentement explicite', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    vi.resetModules();
    const { requestPermissionsAfterLogin } = await import('./requestPermissionsAfterLogin');
    await requestPermissionsAfterLogin();
    expect(h.hasConsent).toHaveBeenCalled();
    expect(h.requestContacts).toHaveBeenCalledTimes(1);
  });
});
