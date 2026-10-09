import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DesktopReadOnlyWorkspace from './DesktopReadOnlyWorkspace';
import { ThemeProvider } from '../lib/theme';

function renderWorkspace() {
  return render(
    <ThemeProvider>
      <DesktopReadOnlyWorkspace
        email="member@lemtel.example"
        organizationId="org-1"
        onRetry={() => undefined}
        onSignOut={() => undefined}
      />
    </ThemeProvider>,
  );
}

describe('DesktopReadOnlyWorkspace navigation', () => {
  beforeEach(() => {
    localStorage.setItem('lemtel:lang', 'en');
    localStorage.setItem('ava-softphone-theme', 'dark');
  });

  afterEach(() => cleanup());

  it('renders an organization home then a distinct safe page for every workspace navigation item', () => {
    renderWorkspace();

    expect(screen.getByTestId('lemtel-desktop-home-page')).toBeTruthy();
    expect(screen.getByText('Organization-secured workspace')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New call/ }));
    expect(screen.getByTestId('lemtel-desktop-phone-page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Calls' }));
    expect(screen.getByTestId('lemtel-desktop-calls-page')).toBeTruthy();
    expect(screen.getByText('Call history is waiting for your line')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    expect(screen.getByTestId('lemtel-desktop-messages-page')).toBeTruthy();
    expect(screen.getByText('Organization chat is waiting to be enabled')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(screen.getByTestId('lemtel-desktop-contacts-page')).toBeTruthy();
    expect(screen.getByText('Organization contacts are waiting to be enabled')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('lemtel-desktop-preferences-page')).toBeTruthy();
    expect(screen.getByText('Desktop preferences')).toBeTruthy();
    expect(screen.getByText('Call experience')).toBeTruthy();
  });

  it('returns to the phone page without enabling calls', () => {
    renderWorkspace();

    const navigation = screen.getByRole('navigation', { name: 'Primary workspace navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Contacts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to phone' }));

    expect(screen.getByTestId('lemtel-desktop-phone-page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Calling is disabled — not provisioned' })).toHaveProperty('disabled', true);
  });

  it('persists safe display and desktop-startup preferences without mounting telephony', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const settings = screen.getByTestId('lemtel-desktop-preferences-page');

    fireEvent.click(within(settings).getByRole('button', { name: 'Bright' }));
    fireEvent.click(within(settings).getByRole('button', { name: 'High' }));
    fireEvent.click(within(settings).getByRole('switch', { name: /Launch Lemtel on startup/ }));

    expect(localStorage.getItem('lemtel.brightness')).toBe('bright');
    expect(localStorage.getItem('lemtel.contrast')).toBe('high');
    expect(localStorage.getItem('lemtel.launchOnStartup')).toBe('on');
  });

  it('does not mount a data-loading or SIP surface for these pages', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, 'DesktopReadOnlyWorkspace.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/useSoftphone|useEffect|fetch\(|supabase\.|ContactsList|RecentsList|OrgChatView|RecordingsList/);
    expect(source).toContain('workspace.noProtectedData');
    expect(source).toContain('workspace.callsPendingBody');
    expect(source).toContain('workspace.contactsPendingBody');
  });
});
