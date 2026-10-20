import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const ORG = '11111111-2222-4333-8444-555555555555';
vi.mock('../lib/supabaseClient', () => ({
  SB_URL: 'https://api.lemtel.example',
  SB_KEY: 'publishable-test',
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'session-token' } } }) } },
}));

import DesktopCallsPage from './DesktopCallsPage';
import { lemtelGatewayAvailable } from '../lib/lemtelPbxDesktop';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DesktopCallsPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { localStorage.setItem('lemtel:lang', 'en'); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('only enables the gateway for a verified organization uuid on the Lemtel backend', () => {
    expect(lemtelGatewayAvailable(ORG)).toBe(true);
    expect(lemtelGatewayAvailable('org-1')).toBe(false);
    expect(lemtelGatewayAvailable(null)).toBe(false);
  });

  it('loads the user’s own call history through lemtel-pbx with the session bearer and no PBX secret', async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [
      { id: 'c1', direction: 'inbound', callerName: 'Alice', callerNumber: '5145550101', destination: '201', startAt: '2026-10-19T14:00:00Z', billsec: 75, duration: 80, hangupCause: 'NORMAL_CLEARING', missed: false, hasRecording: true },
      { id: 'c2', direction: 'inbound', callerName: null, callerNumber: '5145550102', destination: '201', startAt: '2026-10-19T15:00:00Z', billsec: 0, duration: 20, hangupCause: 'NO_ANSWER', missed: true, hasRecording: false },
    ], total: 2 }));
    render(<DesktopCallsPage organizationId={ORG} />);
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('1:15')).toBeTruthy();
    expect(screen.getAllByText('Missed').length).toBeGreaterThan(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.lemtel.example/functions/v1/lemtel-pbx');
    expect(init.headers.Authorization).toBe('Bearer session-token');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ organizationId: ORG, action: 'cdr_list', limit: 100 });
    expect(JSON.stringify(body)).not.toMatch(/password|api_?key|secret/i);
  });

  it('shows voicemail from self_overview and a friendly message for gateway errors', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'extension_not_assigned' }, 409));
    render(<DesktopCallsPage organizationId={ORG} />);
    expect(await screen.findByText('No extension is assigned to you yet.')).toBeTruthy();

    fetchMock.mockResolvedValueOnce(json({ extension: '201', callerIdName: null, forwarding: {}, writesEnabled: false, recentCalls: [],
      voicemail: { enabled: true, messages: [{ uuid: 'm1', createdAt: '2026-10-19T16:00:00Z', callerName: 'Bob', callerNumber: '5145550103', seconds: 42, status: '', transcription: 'Call me back' }] } }));
    fireEvent.click(screen.getByRole('tab', { name: /Voicemail/ }));
    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(screen.getByText('Call me back')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true);
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[1][1].body).action).toBe('self_overview'));
  });
});
