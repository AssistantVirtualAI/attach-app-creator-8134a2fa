import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ invoke: vi.fn(), report: vi.fn(), backendUrl: 'https://api.lemtel.example' }));
vi.mock('../lib/backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('../lib/mobileSupabase', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('../lib/lemtelPrivateDirectory', () => ({ reportLemtelWssFallback: h.report }));
vi.mock('../lib/sip/jssipProvider', () => ({
  buildWssFallbackList: () => ['wss://primary.example:7443', 'wss://backup.example:7444'],
}));

class LocalWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    setTimeout(() => {
      if (url.includes('primary')) this.onerror?.();
      else this.onopen?.();
    }, 0);
  }
  close() {}
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.backendUrl = 'https://api.lemtel.example';
  h.report.mockResolvedValue(false);
  vi.stubGlobal('WebSocket', LocalWebSocket);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('diagnostic WSS sur le nouvel émetteur Lemtel', () => {
  it('affiche un fallback local sans invoquer le journal Planiprêt', async () => {
    const { default: WssDiagnostics } = await import('./WssDiagnostics');
    render(<WssDiagnostics config={{} as never} onClose={vi.fn()} autoRun={false} />);
    expect(screen.getByText(/fallback results stay on this device/)).toBeTruthy();
    fireEvent.click(screen.getByText('Run diagnostics'));
    await waitFor(() => expect(screen.queryByText('Testing endpoints…')).toBeNull());
    expect(screen.getByText(/Port 7443 FAILED/)).toBeTruthy();
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ primaryIndex: 0, fallbackIndex: 1 }));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('conserve le journal WSS dans le build historique uniquement', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    vi.resetModules();
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { default: WssDiagnostics } = await import('./WssDiagnostics');
    render(<WssDiagnostics config={{} as never} onClose={vi.fn()} autoRun={false} />);
    expect(screen.getByText(/fallback events are logged with your user ID/)).toBeTruthy();
    fireEvent.click(screen.getByText('Run diagnostics'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('pp-wss-fallback-log', expect.any(Object)));
    expect(h.report).not.toHaveBeenCalled();
  });
});
