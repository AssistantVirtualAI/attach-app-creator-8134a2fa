import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(), get: vi.fn(), set: vi.fn(), syncDeviceContacts: vi.fn(), hasConsent: vi.fn(),
  backendUrl: 'https://api.lemtel.example',
}));
const legacyUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('./mobileSupabase', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get, set: h.set } }));
vi.mock('./contacts', () => ({ syncDeviceContacts: h.syncDeviceContacts }));
vi.mock('./contactsConsent', () => ({ hasConsent: h.hasConsent }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://api.lemtel.example';
});

describe('new Lemtel issuer never calls Planiprêt endpoints', () => {
  it('shows a number without calling pp-caller-lookup', async () => {
    const { lookupCaller } = await import('./sip/callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result.found).toBe(false);
    expect(result.name).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('refuses both automatic and manual contact sync before accessing contacts or old Preferences', async () => {
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

describe('historical installs keep their historical behavior', () => {
  beforeEach(() => {
    h.backendUrl = legacyUrl;
    vi.resetModules();
  });

  it('still looks up callers through the historical function', async () => {
    h.invoke.mockResolvedValue({ data: { found: true, name: 'Caller', display_number: '+15145550123' }, error: null });
    const { lookupCaller } = await import('./sip/callerLookup');
    expect((await lookupCaller('+1 514 555 0123')).name).toBe('Caller');
    expect(h.invoke).toHaveBeenCalledWith('pp-caller-lookup', { body: { phone: '+1 514 555 0123' } });
  });

  it('still performs a consented contact sync on the historical issuer', async () => {
    h.get.mockResolvedValue({ value: null });
    h.set.mockResolvedValue(undefined);
    h.hasConsent.mockResolvedValue(true);
    h.syncDeviceContacts.mockResolvedValue([{ id: 'c1', name: 'Contact', phones: [{ number: '+1 514 555 0123' }] }]);
    h.invoke.mockResolvedValue({ data: { ok: true, inserted: 1 }, error: null });
    const { runContactsSync } = await import('./contactsSync');
    expect((await runContactsSync({ force: true })).ok).toBe(true);
    expect(h.invoke).toHaveBeenCalledWith('pp-contacts-upsert', expect.objectContaining({
      body: expect.objectContaining({ source: 'device', contacts: expect.any(Array) }),
    }));
  });
});
