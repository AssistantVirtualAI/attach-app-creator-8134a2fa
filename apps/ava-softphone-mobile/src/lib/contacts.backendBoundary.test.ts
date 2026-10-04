import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://api.lemtel.example',
  get: vi.fn(), set: vi.fn(), remove: vi.fn(),
  check: vi.fn(), request: vi.fn(), read: vi.fn(),
  from: vi.fn(),
}));
vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('./mobileSupabase', () => ({ supabase: { from: h.from } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get, set: h.set, remove: h.remove } }));
vi.mock('@capacitor-community/contacts', () => ({ Contacts: {
  checkPermissions: h.check, requestPermissions: h.request, getContacts: h.read,
} }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionStorage.clear();
  h.backendUrl = 'https://api.lemtel.example';
  h.get.mockResolvedValue({ value: JSON.stringify({ given: true, version: '1.0', timestamp: '2026-10-01' }) });
  h.check.mockResolvedValue({ contacts: 'granted' });
  h.read.mockResolvedValue({ contacts: [{ contactId: 'c1', name: { display: 'Old account' }, phones: [{ number: '+15145550123' }] }] });
});
afterEach(() => sessionStorage.clear());

describe('carnet local sur un nouvel émetteur auto-hébergé', () => {
  it('refuse un consentement Planiprêt hérité et son cache même avec permission OS déjà accordée', async () => {
    sessionStorage.setItem('lemtel-device-contacts', JSON.stringify([{ id: 'c1', name: 'Old account', numbers: ['+15145550123'] }]));
    const consent = await import('./contactsConsent');
    const contacts = await import('./contacts');
    const permissions = await import('./permissionState');
    expect(await consent.loadConsent()).toBeNull();
    expect(await consent.hasConsent()).toBe(false);
    expect(consent.hasConsentSync()).toBe(false);
    expect(contacts.loadCachedContacts()).toEqual([]);
    expect(contacts.searchContacts('Old')).toEqual([]);
    expect(await contacts.syncDeviceContacts()).toEqual([]);
    expect(await permissions.getPermState('contacts')).toBe('unavailable');
    expect(await permissions.requestPerm('contacts')).toBe('unavailable');
    expect(h.get).not.toHaveBeenCalled();
    expect(h.check).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('refuse de supprimer des lignes du serveur Planiprêt depuis le nouvel émetteur', async () => {
    const { deleteServerContacts, setConsent } = await import('./contactsConsent');
    await setConsent(true);
    expect(await deleteServerContacts('user-a')).toMatchObject({ ok: false, error: 'lemtel-contacts-service-not-configured' });
    expect(h.get).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('carnet des installations historiques', () => {
  it('conserve le consentement existant et le carnet local sans changer les clés historiques', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    vi.resetModules();
    const consent = await import('./contactsConsent');
    const contacts = await import('./contacts');
    expect(await consent.hasConsent()).toBe(true);
    expect((await contacts.syncDeviceContacts())[0]?.name).toBe('Old account');
    expect(contacts.loadCachedContacts()[0]?.id).toBe('c1');
    expect(h.get).toHaveBeenCalledWith({ key: 'contacts_consent_v1' });
    expect(h.read).toHaveBeenCalledTimes(1);
  });
});
