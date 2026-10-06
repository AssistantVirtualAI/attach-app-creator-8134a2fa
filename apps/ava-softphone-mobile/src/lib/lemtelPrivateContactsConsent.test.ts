import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ enabled: false, get: vi.fn(), set: vi.fn(), remove: vi.fn(), erase: vi.fn() }));
vi.mock('./backendOrigin', () => ({ BACKEND_URL: 'https://api.lemtel.example', BACKEND_STORAGE_SUFFIX: ':https%3A%2F%2Fapi.lemtel.example' }));
vi.mock('./lemtelPrivateDirectory', () => ({
  isLemtelPrivateDirectoryEnabled: () => h.enabled,
  deleteLemtelDeviceContacts: h.erase,
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get, set: h.set, remove: h.remove } }));

const user = '11111111-1111-4111-8111-111111111111';

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); h.enabled = false; });

describe('consentement contacts Lemtel privé', () => {
  it('refuses all storage and deletion in the current unapproved build', async () => {
    const c = await import('./lemtelPrivateContactsConsent');
    expect(c.lemtelPrivateContactsConsentKey(user)).toBeNull();
    expect(await c.setLemtelPrivateContactsConsent(user, true)).toBe(false);
    await expect(c.deleteLemtelDeviceContactsAndRevoke(user)).resolves.toMatchObject({ ok: false, error: 'lemtel-private-directory-disabled' });
    expect(h.set).not.toHaveBeenCalled();
    expect(h.erase).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('accepts only a record scoped to the exact self-hosted origin and authenticated account', async () => {
    const c = await import('./lemtelPrivateContactsConsent');
    const valid = { given: true, timestamp: '2026-10-06T00:00:00.000Z', version: 'lemtel-private-contacts-v1', origin: 'https://api.lemtel.example', userId: user };
    expect(c.isValidLemtelPrivateContactsConsent(valid, user)).toBe(true);
    expect(c.isValidLemtelPrivateContactsConsent({ ...valid, origin: 'https://other.example' }, user)).toBe(false);
    expect(c.isValidLemtelPrivateContactsConsent({ ...valid, userId: '22222222-2222-4222-8222-222222222222' }, user)).toBe(false);
    expect(c.isValidLemtelPrivateContactsConsent({ ...valid, version: '1.0' }, user)).toBe(false);
  });
});
