import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://api.lemtel.example',
  legacyInvoke: vi.fn(),
  privateInvoke: vi.fn(),
}));

vi.mock('../backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('../mobileSupabase', () => ({ supabase: { functions: { invoke: h.legacyInvoke } } }));
vi.mock('../i18n', () => ({ txStatic: (fr: string, en: string) => en || fr }));
vi.mock('../lemtelPrivateDirectory', () => ({ invokeLemtelPrivateDirectory: h.privateInvoke }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://api.lemtel.example';
});

describe('caller lookup Lemtel privé', () => {
  it('uses only the new private adapter on a future self-hosted origin', async () => {
    h.privateInvoke.mockResolvedValue({
      found: true,
      source: 'device',
      name: 'Synthetic Contact',
      display_number: '+15145550123',
      raw_number: '+15145550123',
      phone_normalized: '+15145550123',
    });
    const { lookupCaller } = await import('./callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result).toMatchObject({ found: true, source: 'device', name: 'Synthetic Contact' });
    expect(h.privateInvoke).toHaveBeenCalledWith('lemtel-caller-lookup', { phone: '+15145550123' });
    expect(h.legacyInvoke).not.toHaveBeenCalled();
  });

  it('keeps a number-only local fallback when the private adapter is disabled or rejects data', async () => {
    h.privateInvoke.mockResolvedValue(null);
    const { lookupCaller } = await import('./callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result).toMatchObject({ found: false, source: null, raw_number: '+1 514 555 0123' });
    expect(h.privateInvoke).toHaveBeenCalledTimes(1);
    expect(h.legacyInvoke).not.toHaveBeenCalled();
  });

  it('retains the historical lookup endpoint only for the legacy origin', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    h.legacyInvoke.mockResolvedValue({
      data: { found: true, source: 'maestro', name: 'Historical Contact', display_number: '+15145550123', raw_number: '+15145550123', phone_normalized: '+15145550123' },
      error: null,
    });
    const { lookupCaller } = await import('./callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result).toMatchObject({ found: true, source: 'maestro' });
    expect(h.legacyInvoke).toHaveBeenCalledWith('pp-caller-lookup', { body: { phone: '+1 514 555 0123' } });
    expect(h.privateInvoke).not.toHaveBeenCalled();
  });
});
