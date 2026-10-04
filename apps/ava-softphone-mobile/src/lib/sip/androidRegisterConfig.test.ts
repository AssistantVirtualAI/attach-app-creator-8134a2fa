import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
  },
}));

describe('Android JsSIP REGISTER config', () => {
  beforeEach(() => {
    vi.resetModules();
    (window as any).JsSIP = {
      WebSocketInterface: vi.fn().mockImplementation((url: string) => ({ url })),
      UA: vi.fn().mockImplementation((opts: any) => ({ __opts: opts, on: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    };
  });

  afterEach(() => {
    delete (window as any).JsSIP;
    vi.restoreAllMocks();
  });

  it('uses WSS sockets and supported Contact/Route settings on Android', async () => {
    const { createSIPUA } = await import('./jssipProvider');
    const ua = await createSIPUA({
      extension: '300',
      password: 'pw',
      domain: 'lemtel.lemtel.tel',
      wssUrl: 'wss://credential.example.com:7443',
    }, 200);

    expect((window as any).JsSIP.WebSocketInterface).toHaveBeenCalledWith('wss://credential.example.com:7443');
    expect((ua as any).__opts.contact_uri).toContain('transport=wss');
    expect((ua as any).__opts.use_preloaded_route).toBe(true);
    expect((ua as any).__opts).not.toHaveProperty('hack_via_tcp');
    expect((ua as any).__opts).not.toHaveProperty('hack_wss_in_transport');
  });
});
