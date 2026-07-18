import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('vertoProvider', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // jsdom is already provided by the mobile app's vitest setup; ensure a
    // stub `$` exists so the provider's script-injection short-circuits.
    (window as any).$ = {
      verto: function (opts: any, cbs: any) {
        // Simulate a successful login on next tick.
        setTimeout(() => cbs.onWSLogin(this, true), 0);
        this.opts = opts;
        this.cbs = cbs;
        this.newCall = vi.fn(() => ({
          callID: 'call-1',
          hangup: vi.fn(),
          answer: vi.fn(),
          dtmf: vi.fn(),
          hold: vi.fn(),
          unhold: vi.fn(),
          toggleHold: vi.fn(),
          rtc: undefined,
        }));
        this.logout = vi.fn();
      },
    };
  });

  afterEach(() => {
    delete (window as any).$;
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it('initVerto resolves on onWSLogin(true) and reports connected', async () => {
    const { initVerto, getVertoClient } = await import('./vertoProvider');
    const client = await initVerto({
      host: 'pbxnode.lemtel.tel',
      port: 8082,
      login: '113',
      password: 'secret',
      caller_id_name: 'Mo',
      caller_id_number: '113',
    });
    expect(client).toBe(getVertoClient());
    expect(client.isConnected()).toBe(true);
  });

  it('vertoCall creates a dialog via verto.newCall', async () => {
    const { initVerto, vertoCall } = await import('./vertoProvider');
    await initVerto({
      host: 'pbxnode.lemtel.tel', port: 8082, login: '113',
      password: 'secret', caller_id_name: 'Mo', caller_id_number: '113',
    });
    const dialog = vertoCall('5145551212', 'Mo', '113');
    expect(dialog?.callID).toBe('call-1');
  });
});
