import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ report: vi.fn(), backendUrl: 'https://lemtel.assistantvirtualai.com' }));
vi.mock('../lib/backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
}));
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
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
  h.report.mockResolvedValue(false);
  vi.stubGlobal('WebSocket', LocalWebSocket);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('diagnostic WSS sur le client Lemtel canonique', () => {
  it('n’appelle jamais le journal historique et réduit la télémétrie au résultat opaque', async () => {
    const { default: WssDiagnostics } = await import('./WssDiagnostics');
    render(<WssDiagnostics config={{} as never} onClose={vi.fn()} autoRun={false} />);
    expect(screen.getByText(/fallback telemetry is reduced/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Run diagnostics'));
    await waitFor(() => expect(screen.queryByText('Testing endpoints…')).toBeNull());
    expect(screen.getByText(/Port 7443 FAILED/)).toBeTruthy();
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ primaryIndex: 0, fallbackIndex: 1 }));
  });
});
