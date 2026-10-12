import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://lemtel.assistantvirtualai.com',
  privateInvoke: vi.fn(),
}));

vi.mock('../backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
}));
vi.mock('../i18n', () => ({ txStatic: (fr: string, en: string) => en || fr }));
vi.mock('../lemtelPrivateDirectory', () => ({ invokeLemtelPrivateDirectory: h.privateInvoke }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
});

describe('caller lookup Lemtel privé', () => {
  it('uses only the Lemtel private adapter on the canonical origin', async () => {
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
  });

  it('keeps a number-only local fallback when the private adapter is disabled or rejects data', async () => {
    h.privateInvoke.mockResolvedValue(null);
    const { lookupCaller } = await import('./callerLookup');
    const result = await lookupCaller('+1 514 555 0123');
    expect(result).toMatchObject({ found: false, source: null, raw_number: '+1 514 555 0123' });
    expect(h.privateInvoke).toHaveBeenCalledTimes(1);
  });
});
