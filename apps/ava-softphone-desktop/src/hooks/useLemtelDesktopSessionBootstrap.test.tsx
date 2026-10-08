import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../lib/supabaseClient', () => ({ SB_URL: 'https://lemtel.example.invalid', SB_KEY: 'public-key' }));

const edgeCall = vi.hoisted(() => vi.fn());
const fetchStub = vi.hoisted(() => vi.fn(async (url: string, init: RequestInit) => {
  const functionName = String(url).split('/functions/v1/')[1];
  const response = await edgeCall(functionName, init);
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body,
  };
}));
vi.stubGlobal('fetch', fetchStub);

import { useLemtelDesktopSessionBootstrap } from './useLemtelDesktopSessionBootstrap';

const acceptedBootstrap = {
  user: { id: 'user_1', email: 'member@example.invalid', displayName: 'Member', locale: 'fr' },
  organizations: [{ organizationId: 'org_lemtel', role: 'owner', organization: { id: 'org_lemtel', display_name: 'Lemtel', slug: 'lemtel', status: 'active' } }],
  telephony: { status: 'not_provisioned' },
};

describe('useLemtelDesktopSessionBootstrap', () => {
  beforeEach(() => {
    edgeCall.mockReset();
    fetchStub.mockClear();
  });

  it('uses only the authenticated GET bootstrap and enters a safe not-provisioned state', async () => {
    edgeCall.mockResolvedValue({ status: 200, body: acceptedBootstrap });
    const { result } = renderHook(() => useLemtelDesktopSessionBootstrap('session-token'));

    await waitFor(() => expect(result.current.status).toBe('not_provisioned'));
    expect(result.current.organizationId).toBe('org_lemtel');
    expect(result.current.telephonyEnabled).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(edgeCall).toHaveBeenCalledWith('lemtel-session-bootstrap', expect.objectContaining({ method: 'GET' }));
  });

  it('does not call the missing legacy lifecycle route when it would return 500', async () => {
    edgeCall.mockImplementation(async (name: string) => {
      if (name === 'lemtel-client-config') return { status: 500, body: { msg: 'InvalidWorkerCreation' } };
      if (name === 'lemtel-session-bootstrap') return { status: 200, body: acceptedBootstrap };
      throw new Error(`unexpected function ${name}`);
    });
    const { result } = renderHook(() => useLemtelDesktopSessionBootstrap('session-token'));

    await waitFor(() => expect(result.current.status).toBe('not_provisioned'));
    expect(edgeCall.mock.calls.map(([name]) => name)).toEqual(['lemtel-session-bootstrap']);
    expect(result.current.telephonyEnabled).toBe(false);
  });

  it('keeps a failed session confirmation retryable instead of showing a legacy unavailable state', async () => {
    edgeCall.mockResolvedValue({ status: 503, body: { error: 'server_not_configured' } });
    const { result } = renderHook(() => useLemtelDesktopSessionBootstrap('session-token'));

    await waitFor(() => expect(result.current.status).toBe('retryable_error'));
    expect(result.current.telephonyEnabled).toBe(false);

    edgeCall.mockResolvedValue({ status: 200, body: acceptedBootstrap });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe('not_provisioned');
  });

  it('does not call a server endpoint without a session', () => {
    const { result } = renderHook(() => useLemtelDesktopSessionBootstrap(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.telephonyEnabled).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
