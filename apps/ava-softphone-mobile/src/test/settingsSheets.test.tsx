/**
 * Verifies every sheet-opening Settings row is tappable and opens the
 * correct in-app sheet (Ringtone, Audio output, Clear cache).
 * Phase 23A: no local DND/forwarding control exists; the portal is the authority.
 * Also verifies Wi-Fi/LTE chip renders from the live network listener.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ---- Mocks --------------------------------------------------------------
vi.mock('../lib/mobileApi', () => ({
  mobileApi: {
    me: vi.fn().mockResolvedValue({
      user: { name: 'Test User' },
      extension: { number: '300', sipDomain: 'lemtel.tel' },
      domain: { sipDomain: 'lemtel.tel' },
      organization: { name: 'Lemtel' },
      status: { doNotDisturb: false, forwarding: null },
      permissions: { admin: false, canManageUsers: false, canManageNumbers: false, canManageRouting: false, canManageAgents: false },
      role: 'agent',
      dataScope: 'own',
    }),
  },
}));
vi.mock('../lib/permissions', () => ({
  checkAllPermissions: vi.fn().mockResolvedValue({ microphone: 'granted', speaker: 'granted', contacts: 'granted', notifications: 'granted' }),
  openAppSettings: vi.fn(),
}));
vi.mock('../lib/recordingConsent', () => ({
  getAnnounceConsent: () => true,
  setAnnounceConsent: vi.fn(),
}));
vi.mock('../lib/sip/audioOutput', () => ({
  setRoute: vi.fn().mockResolvedValue(true),
}));
const capListeners: Array<(s: any) => void> = [];
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: 'wifi' }),
    addListener: vi.fn().mockImplementation((_evt: string, cb: (s: any) => void) => {
      capListeners.push(cb);
      return Promise.resolve({ remove: () => Promise.resolve() });
    }),
  },
}));

import SettingsScreen from '../screens/SettingsScreen';
import { mobileApi } from '../lib/mobileApi';
import { ThemeProvider } from '../lib/ThemeContext';
import { MobileI18nProvider as LangProvider } from '../lib/i18n';

const creds: any = { extension: '300', displayName: 'Test', email: 't@x.com', sipDomain: 'lemtel.tel', role: 'agent' };
const sp: any = { snap: { status: 'registered' }, sipConfig: { wssUrl: 'wss://x' }, sipLog: [], reconnect: vi.fn(), clearSipState: vi.fn() };

function renderScreen(portalTelephonyPolicy?: any) {
  return render(
    <ThemeProvider>
      <LangProvider>
        <SettingsScreen creds={creds} sp={sp} onSignOut={() => {}} portalTelephonyPolicy={portalTelephonyPolicy} />
      </LangProvider>
    </ThemeProvider>
  );
}

beforeEach(() => { capListeners.length = 0; localStorage.clear(); });

describe('SettingsScreen — rows & sheets', () => {
  it('opens the Ringtone sheet when the row is tapped', async () => {
    renderScreen();
    const row = await screen.findByText(/^(Ringtone|Sonnerie)$/i);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getAllByText(/AVA Default/i).length).toBeGreaterThan(1));
  });

  it('opens the Audio output sheet with all route choices', async () => {
    renderScreen();
    const row = await screen.findByText(/^(Audio output|Sortie audio)$/i);
    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.getByText(/^(Earpiece|Écouteur)$/i)).toBeDefined();
      expect(screen.getByText(/Bluetooth/i)).toBeDefined();
    });
  });

  it('Phase 23A: without portal policy no local DND/forwarding control or input is rendered', async () => {
    renderScreen();
    await screen.findByText(/^(Ringtone|Sonnerie)$/i);
    expect(screen.queryByText(/^(Do not disturb|Ne pas déranger)$/i)).toBeNull();
    expect(screen.queryByText(/^(Call forwarding|Transfert d[’']appels?)$/i)).toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.queryByText(/Forwarding number|Numéro de transfert/i)).toBeNull();
  });

  it('opens the Clear cache confirmation sheet', async () => {
    renderScreen();
    const row = await screen.findByText(/Clear app cache|Vider le cache/i);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText(/AI summaries|résumés IA/i)).toBeDefined());
  });

  it('persists noise-cancellation preference to localStorage', async () => {
    renderScreen();
    const row = await screen.findByText(/Noise cancel|Réduction/i);
    fireEvent.click(row);
    await waitFor(() => expect(localStorage.getItem('ava.nc_enabled')).toBe('off'));
  });

  it('updates the network chip when Capacitor Network fires networkStatusChange', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getAllByText(/Wi-Fi/i).length).toBeGreaterThan(0));
    await act(async () => {
      capListeners.forEach((cb) => cb({ connected: true, connectionType: 'cellular' }));
    });
    await waitFor(() => expect(screen.getAllByText(/LTE|Cellular/i).length).toBeGreaterThan(0));
  });
});

describe('SettingsScreen — Phase 22B portal policy (read-only)', () => {
  const policy = { dndState: 'enabled', forwardingState: 'disabled', recordingPolicy: 'portal_managed', voicemailPolicy: 'enabled' };

  it('without policy prop the section is not rendered', async () => {
    renderScreen();
    await screen.findByText(/^(Ringtone|Sonnerie)$/i);
    expect(screen.queryByText(/^(Politique du portail|Portal policy)$/)).toBeNull();
    expect(document.querySelector('[data-testid="portal-policy"]')).toBeNull();
  });

  it('with policy shows the four states and the portal authority note', async () => {
    renderScreen(policy);
    const card = await screen.findByTestId('portal-policy');
    const txt = card.textContent || '';
    expect(txt).toMatch(/Portal policy|Politique du portail/);
    expect(txt).toMatch(/Do not disturb: enabled|Ne pas déranger : activé/);
    expect(txt).toMatch(/Call forwarding: disabled|Transfert d’appels : désactivé/);
    expect(txt).toMatch(/Recording: portal managed|Enregistrement : géré par le portail/);
    expect(txt).toMatch(/Voicemail: enabled|Boîte vocale : activée/);
    expect(txt).toMatch(/applied by the portal|appliqués par le portail/);
  });

  it('card has no interactive control and triggers no mutation', async () => {
    renderScreen(policy);
    const card = await screen.findByTestId('portal-policy');
    expect(card.querySelectorAll('button, input, select, textarea, [role="switch"], [role="checkbox"], [role="button"]').length).toBe(0);
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    const meCalls = (mobileApi.me as any).mock.calls.length;
    card.querySelectorAll('*').forEach((el) => fireEvent.click(el));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((mobileApi as any).setDnd).toBeUndefined();
    expect((mobileApi as any).setForwarding).toBeUndefined();
    expect((mobileApi.me as any).mock.calls.length).toBe(meCalls);
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('Phase 23A: with policy, DND/forwarding appear only as non-interactive labels inside the card', async () => {
    renderScreen(policy);
    const card = await screen.findByTestId('portal-policy');
    const dnd = screen.getAllByText(/Do not disturb|Ne pas déranger/);
    const fwd = screen.getAllByText(/Call forwarding|Transfert d[’']appels/);
    for (const el of [...dnd, ...fwd]) {
      expect(card.contains(el)).toBe(true);
      expect(el.tagName).toBe('LI');
      expect(el.closest('button, [role="switch"], [role="button"]')).toBeNull();
    }
    expect(document.querySelector('input[type="tel"]')).toBeNull();
  });
});
