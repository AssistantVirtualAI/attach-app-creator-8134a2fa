import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ backendUrl: 'https://api.lemtel.example', loadConsent: vi.fn() }));
vi.mock('../lib/backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ micStatus: 'granted', requestMicrophonePermission: vi.fn() }) }));
vi.mock('../lib/contactsConsent', () => ({ loadConsent: h.loadConsent, hasConsent: vi.fn(), setConsent: vi.fn() }));
vi.mock('../lib/contacts', () => ({ loadCachedContacts: () => [], syncDeviceContacts: vi.fn() }));
vi.mock('../lib/audit', () => ({ audit: vi.fn() }));
vi.mock('../components/Dialpad', () => ({ default: () => <div>Dialpad</div> }));
vi.mock('../components/WssDiagnostics', () => ({ default: () => null }));
vi.mock('../components/ContactsConsentSheet', () => ({ default: () => null }));
vi.mock('../components/PermissionBlockedScreen', () => ({ default: () => null }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  h.backendUrl = 'https://api.lemtel.example';
  h.loadConsent.mockResolvedValue(null);
});
afterEach(cleanup);

describe('numéroteur mobile selon l’origine Auth', () => {
  it('ne propose pas un bouton Contacts inopérant sur le backend auto-hébergé', async () => {
    const { default: DialerScreen } = await import('./DialerScreen');
    render(<DialerScreen sp={{ sipStatus: 'registered', call: vi.fn() }} haptic={vi.fn()} />);
    expect(screen.getByText('Dialpad')).toBeTruthy();
    expect(screen.getByRole('button', { name: '☏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contacts' })).toBeNull();
    expect(h.loadConsent).not.toHaveBeenCalled();
  });

  it('conserve l’accès Contacts sur l’origine historique', async () => {
    h.backendUrl = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
    vi.resetModules();
    const { default: DialerScreen } = await import('./DialerScreen');
    render(<DialerScreen sp={{ sipStatus: 'registered', call: vi.fn() }} haptic={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Contacts' })).toBeTruthy();
    expect(h.loadConsent).toHaveBeenCalled();
  });
});
