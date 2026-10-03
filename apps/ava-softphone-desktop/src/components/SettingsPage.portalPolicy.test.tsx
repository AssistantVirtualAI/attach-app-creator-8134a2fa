import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Local mocks only: no network, no SIP stack, no Electron bridge.
const sip = vi.hoisted(() => ({
  getSnapshot: vi.fn(() => ({ status: 'registered' })),
  subscribe: vi.fn(() => () => {}),
  restart: vi.fn(),
  testAudioDevices: vi.fn(),
  downloadDebugReport: vi.fn(),
}));
vi.mock('../lib/sip/jssipProvider', () => ({ sipProvider: sip }));

import SettingsPage, { type PortalTelephonyPolicy } from './SettingsPage';
import { ThemeProvider } from '../lib/theme';

const openExternal = vi.fn();
const setLaunchOnStartup = vi.fn();
const creds = { email: 't@example.invalid', extension: '300', displayName: 'Test' };
const policy: PortalTelephonyPolicy = { dndState: 'enabled', forwardingState: 'disabled', recordingPolicy: 'portal_managed', voicemailPolicy: 'enabled' };

function renderPage(p?: PortalTelephonyPolicy | null) {
  return render(<ThemeProvider><SettingsPage creds={creds} onSignOut={() => {}} onBack={() => {}} portalTelephonyPolicy={p} /></ThemeProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).electronAPI = { openExternal, setLaunchOnStartup };
});

describe('SettingsPage — Phase 22C portal policy (read-only)', () => {
  it('without prop no portal policy section is rendered', () => {
    renderPage();
    expect(screen.queryByTestId('desktop-portal-policy')).toBeNull();
    expect(screen.queryByText('Portal policy')).toBeNull();
  });

  it('with a full policy shows four labels and the portal authority note', () => {
    renderPage(policy);
    const card = screen.getByTestId('desktop-portal-policy');
    const txt = card.textContent || '';
    for (const l of ['Portal policy', 'Do not disturb: enabled', 'Call forwarding: disabled', 'Recording: portal managed', 'Voicemail: enabled',
      'Telephony settings are applied by the portal. Change them in the Lemtel portal.']) expect(txt).toContain(l);
  });

  it('card has no interactive element', () => {
    renderPage(policy);
    const card = screen.getByTestId('desktop-portal-policy');
    expect(card.querySelectorAll('button, input, select, textarea, a, [role="switch"], [role="checkbox"], [role="button"], [tabindex]').length).toBe(0);
  });

  it('clicking every descendant triggers no openExternal, sip restart or local mutation', () => {
    renderPage(policy);
    const before = JSON.stringify({ ...localStorage });
    const card = screen.getByTestId('desktop-portal-policy');
    card.querySelectorAll('*').forEach((el) => fireEvent.click(el));
    fireEvent.click(card);
    expect(openExternal).not.toHaveBeenCalled();
    expect(sip.restart).not.toHaveBeenCalled();
    expect(setLaunchOnStartup).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });

  it('existing settings remain rendered, with portal card before Call Settings', () => {
    renderPage(policy);
    for (const l of ['Call Settings', 'Auto Answer', 'Announce Call Recording', 'Call Forwarding', 'Voicemail Settings', 'Manage in portal', 'Sync Status']) expect(screen.getByText(l)).toBeTruthy();
    const card = screen.getByTestId('desktop-portal-policy');
    const calls = screen.getByText('Call Settings');
    expect(card.compareDocumentPosition(calls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
