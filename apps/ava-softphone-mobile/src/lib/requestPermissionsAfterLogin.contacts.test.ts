import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://lemtel.assistantvirtualai.com',
  get: vi.fn(), set: vi.fn(), hasConsent: vi.fn(), requestContacts: vi.fn(),
  addListener: vi.fn(), checkPush: vi.fn(), requestPush: vi.fn(), register: vi.fn(),
}));
vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
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
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
  h.get.mockResolvedValue({ value: null });
  h.set.mockResolvedValue(undefined);
  h.hasConsent.mockResolvedValue(true);
  h.checkPush.mockResolvedValue({ receive: 'denied' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('première connexion iOS Lemtel : permissions contacts', () => {
  it('ne charge pas le plugin du carnet malgré un consentement historique', async () => {
    const { requestPermissionsAfterLogin } = await import('./requestPermissionsAfterLogin');
    await requestPermissionsAfterLogin();
    expect(h.hasConsent).not.toHaveBeenCalled();
    expect(h.requestContacts).not.toHaveBeenCalled();
  });

  it('reste fermé même si un test injecte une origine non approuvée', async () => {
    h.backendUrl = 'https://unapproved.example';
    vi.resetModules();
    const { requestPermissionsAfterLogin } = await import('./requestPermissionsAfterLogin');
    await requestPermissionsAfterLogin();
    expect(h.hasConsent).not.toHaveBeenCalled();
    expect(h.requestContacts).not.toHaveBeenCalled();
  });
});
