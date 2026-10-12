import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backendUrl: 'https://lemtel.assistantvirtualai.com',
  credentials: { organizationId: '11111111-1111-4111-8111-111111111111' } as any,
  invoke: vi.fn(),
}));

vi.mock('./backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
}));
vi.mock('./creds', () => ({ getCredentials: vi.fn(() => Promise.resolve(h.credentials)) }));
vi.mock('./mobileSupabase', () => ({ supabase: { functions: { invoke: h.invoke } } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
  h.credentials = { organizationId: '11111111-1111-4111-8111-111111111111' };
  vi.stubEnv('VITE_LEMTEL_PRIVATE_DIRECTORY', '');
});

describe('Lemtel private-directory adapter', () => {
  it('requires the canonical origin and a separate approved build flag', async () => {
    const module = await import('./lemtelPrivateDirectory');
    expect(module.resolveLemtelPrivateDirectoryEnabled('https://lemtel.assistantvirtualai.com', 'approved')).toBe(true);
    expect(module.resolveLemtelPrivateDirectoryEnabled('https://lemtel.assistantvirtualai.com', undefined)).toBe(false);
    expect(module.resolveLemtelPrivateDirectoryEnabled('https://unapproved.example', 'approved')).toBe(false);
  });

  it('is inert in current builds and does not invoke a Lemtel function or read a stored organization', async () => {
    const module = await import('./lemtelPrivateDirectory');
    expect(await module.getLemtelPrivateDirectoryOrganizationId()).toBeNull();
    expect(await module.invokeLemtelPrivateDirectory('lemtel-caller-lookup', { phone: '+15145550123' })).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('serializes WSS telemetry without a raw endpoint or raw reason', async () => {
    const module = await import('./lemtelPrivateDirectory');
    const payload = module.buildLemtelWssFallbackPayload({
      primaryIndex: 0,
      fallbackIndex: 1,
      primaryReason: 'TLS certificate failure on wss://secret-pbx.example:7443',
      primaryLatencyMs: 18,
      fallbackState: 'ok',
      fallbackLatencyMs: 22,
    });
    expect(payload).toEqual({
      primaryEndpointId: 'candidate-0',
      fallbackEndpointId: 'candidate-1',
      primaryFailureCode: 'tls',
      primaryLatencyMs: 18,
      fallbackState: 'ok',
      fallbackLatencyMs: 22,
    });
    expect(JSON.stringify(payload)).not.toContain('secret-pbx.example');
  });

  it('bounds telemetry and rejects invalid endpoint positions locally', async () => {
    const module = await import('./lemtelPrivateDirectory');
    expect(module.classifyLemtelWssFailure('Connection refused')).toBe('rejected');
    expect(module.classifyLemtelWssFailure('unknown')).toBe('unknown');
    expect(module.boundedLatency(-1)).toBe(0);
    expect(module.boundedLatency(30_001)).toBe(0);
    expect(module.buildLemtelWssFallbackPayload({ primaryIndex: 0, fallbackIndex: 0, fallbackState: 'ok' })).toBeNull();
    await expect(module.reportLemtelWssFallback({ primaryIndex: 0, fallbackIndex: 0, fallbackState: 'ok' })).resolves.toBe(false);
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
