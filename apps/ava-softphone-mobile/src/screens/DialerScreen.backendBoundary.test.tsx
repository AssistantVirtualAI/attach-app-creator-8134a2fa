import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ backendUrl: 'https://lemtel.assistantvirtualai.com', loadConsent: vi.fn() }));
vi.mock('../lib/backendOrigin', () => ({
  get BACKEND_URL() { return h.backendUrl; },
  LEMTEL_CANONICAL_BACKEND_URL: 'https://lemtel.assistantvirtualai.com',
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
  h.backendUrl = 'https://lemtel.assistantvirtualai.com';
  h.loadConsent.mockResolvedValue(null);
});
afterEach(cleanup);

describe('numéroteur mobile Lemtel canonique', () => {
  it('ne propose pas un bouton Contacts tant qu’un service Lemtel dédié ne l’active pas', async () => {
    const { default: DialerScreen } = await import('./DialerScreen');
    render(<DialerScreen sp={{ sipStatus: 'registered', call: vi.fn() }} haptic={vi.fn()} />);
    expect(screen.getByText('Dialpad')).toBeTruthy();
    expect(screen.getByRole('button', { name: '☏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contacts' })).toBeNull();
    expect(h.loadConsent).not.toHaveBeenCalled();
  });
});
