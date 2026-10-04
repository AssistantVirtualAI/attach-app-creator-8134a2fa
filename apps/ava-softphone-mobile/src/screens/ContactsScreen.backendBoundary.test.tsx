import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  get: vi.fn(), read: vi.fn(), check: vi.fn(), request: vi.fn(), restGet: vi.fn(),
}));
vi.mock('../lib/backendOrigin', () => ({
  BACKEND_URL: 'https://api.lemtel.example',
  LEGACY_BACKEND_URL: 'https://gejxisrqtvxavbrfcoxz.supabase.co',
}));
vi.mock('../hooks/useMobileCredentials', () => ({
  useMobileCredentials: () => ({ loading: false, accessToken: 'test-token', domainUuid: 'd1', organizationId: 'o1', sipDomain: 'example.test', userId: 'u1' }),
}));
vi.mock('../lib/mobileSupabase', () => ({
  restGet: h.restGet,
  restPost: vi.fn(),
  authedRealtime: () => ({
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: vi.fn(),
  }),
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: h.get } }));
vi.mock('@capacitor-community/contacts', () => ({ Contacts: {
  checkPermissions: h.check, requestPermissions: h.request, getContacts: h.read,
} }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.restGet.mockResolvedValue([]);
  h.get.mockResolvedValue({ value: JSON.stringify({ given: true, version: '1.0' }) });
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('répertoire mobile avec une nouvelle origine Lemtel', () => {
  it('cache un carnet historique et ne présente aucune demande de consentement Planiprêt', async () => {
    sessionStorage.setItem('lemtel-device-contacts', JSON.stringify([
      { id: 'legacy', name: 'Old account', numbers: ['+15145550123'] },
    ]));
    const { default: ContactsScreen } = await import('./ContactsScreen');
    render(<ContactsScreen sp={{}} />);
    await waitFor(() => expect(h.restGet).toHaveBeenCalled());
    expect(screen.getByText(/(?:carnet du téléphone|phone address book)/i)).toBeTruthy();
    expect(screen.queryByText('Old account')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Mobile')).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });
});
