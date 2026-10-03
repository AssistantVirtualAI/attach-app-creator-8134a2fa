import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../lib/supabaseClient', () => ({ SB_URL: 'https://example.invalid', SB_KEY: 'anon' }));
// Simulated lifecycle function: every HTTP call is mocked, no real server is contacted.
const edgeCall = vi.hoisted(() => vi.fn());
const fetchStub = vi.hoisted(() => vi.fn(async (url: string, init: any) => {
  const fn = String(url).split('/functions/v1/')[1];
  const token = String(init.headers.Authorization).replace('Bearer ', '');
  try {
    const data = await edgeCall(fn, token, JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => data };
  } catch (e: any) {
    if (e?.message === 'Failed to fetch') throw e;
    return { ok: false, status: 403, json: async () => ({ error: e?.message }) };
  }
}));
vi.stubGlobal('fetch', fetchStub);

import { useLemtelDesktopClientConfig } from './useLemtelDesktopClientConfig';
import { getInstallationRef, saveCachedManifest } from '../lib/lemtelDesktopClientConfig';

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
function manifest(over: Record<string, any> = {}) {
  const m: any = {
    schemaVersion: 'lemtel_client_config_manifest_v1',
    identity: { organizationRef: 'org_a', domainRef: 'dom_a', extensionRef: 'ext_a', userRef: 'usr_a', privacyScope: 'own_extension_only' },
    access: { mobileEnabled: false, desktopEnabled: true, accountState: 'active', signInMode: 'portal_password' },
    revision: { manifestRevision: 'rev_a', issuedAt: new Date().toISOString(), expiresAt: future(), refreshMode: 'foreground_and_revision_check', revocationBehavior: 'stop_sip_and_clear_local_session' },
    device: { deviceRef: 'dev_' + 'b'.repeat(32), deviceState: 'approved', deviceRevision: 'devrev_a', deviceAction: 'none' },
    telephonyPolicy: { credentialRevisionRef: 'credrev_a', dndState: 'disabled', forwardingState: 'disabled', recordingPolicy: 'portal_managed', voicemailPolicy: 'enabled', callsPrivacyScope: 'own_extension_only', recordingsPrivacyScope: 'own_extension_only', voicemailPrivacyScope: 'own_extension_only', transcriptsPrivacyScope: 'own_extension_only' },
    routing: { routingMode: 'direct_current', routingAssignmentRef: 'route_direct_current_v1', fallbackMode: 'direct_current', edgeFeatureGate: false },
    capabilities: {
      maestroSyncState: 'disabled',
      avaCallActionState: 'disabled',
      avaSmsActionState: 'disabled',
      microsoftSsoState: 'not_ready',
    },
    observability: { diagnosticLevel: 'error_only', redactionPolicyRef: 'redact_lemtel_default_v1', supportBundleAllowed: false },
  };
  for (const [p, v] of Object.entries(over)) { const [a, b] = p.split('.'); m[a][b] = v; }
  return m;
}

describe('useLemtelDesktopClientConfig', () => {
  it('only the lifecycle function is called', async () => {
    edgeCall.mockResolvedValueOnce(manifest());
    const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
    await waitFor(() => expect(result.current.status).toBe('allowed'));
    for (const [url] of fetchStub.mock.calls) expect(String(url)).toMatch(/\/functions\/v1\/lemtel-client-config$/);
  });

  beforeEach(() => { localStorage.clear(); edgeCall.mockReset(); fetchStub.mockClear(); });

  it('portal token: one desktop register, valid manifest, sip allowed', async () => {
    edgeCall.mockResolvedValueOnce(manifest());
    const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
    expect(result.current.sipAllowed).toBe(false);
    await waitFor(() => expect(result.current.status).toBe('allowed'));
    expect(result.current.sipAllowed).toBe(true);
    expect(edgeCall).toHaveBeenCalledTimes(1);
    const [fn, , body] = edgeCall.mock.calls[0];
    expect(fn).toBe('lemtel-client-config');
    expect(body).toEqual({ action: 'register', platform: 'desktop', installationRef: await getInstallationRef() });
  });

  it('no session token: unavailable (no legacy mode), no server call, no telephony', () => {
    const { result } = renderHook(() => useLemtelDesktopClientConfig(null));
    expect(result.current.status).toBe('unavailable');
    expect(result.current.sipAllowed).toBe(false);
    expect(edgeCall).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('device_revoked or desktop access removed → pending_block', async () => {
    edgeCall.mockRejectedValueOnce(new Error('device_revoked'));
    const a = renderHook(() => useLemtelDesktopClientConfig('tok'));
    await waitFor(() => expect(a.result.current.status).toBe('pending_block'));
    expect(a.result.current.sipAllowed).toBe(false);
    edgeCall.mockResolvedValueOnce(manifest({ 'access.desktopEnabled': false }));
    const b = renderHook(() => useLemtelDesktopClientConfig('tok2'));
    await waitFor(() => expect(b.result.current.status).toBe('pending_block'));
  });

  it('finalizeBlock → blocked, clears only the manifest cache', async () => {
    const ref = await getInstallationRef();
    await saveCachedManifest(manifest());
    edgeCall.mockRejectedValueOnce(new Error('platform_access_disabled'));
    const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
    await waitFor(() => expect(result.current.status).toBe('pending_block'));
    act(() => result.current.finalizeBlock());
    expect(result.current.status).toBe('blocked');
    expect(result.current.sipAllowed).toBe(false);
    await waitFor(() => expect(Object.keys(localStorage).some((k) => k.includes('client_config'))).toBe(false));
    expect(await getInstallationRef()).toBe(ref);
  });

  it('transient error + valid cache → controlled allow', async () => {
    await saveCachedManifest(manifest());
    edgeCall.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
    await waitFor(() => expect(result.current.status).toBe('allowed'));
  });

  it('transient error + expired cache → unavailable, no sip', async () => {
    const m = manifest({ 'revision.expiresAt': new Date(Date.now() + 1000).toISOString() });
    await saveCachedManifest(m);
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      edgeCall.mockRejectedValueOnce(new Error('Failed to fetch'));
      const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.sipAllowed).toBe(false);
    } finally { Date.now = realNow; }
  });

  it('foreground refresh before 900 s does not call; forced retry calls exactly once', async () => {
    edgeCall.mockResolvedValue(manifest());
    const { result } = renderHook(() => useLemtelDesktopClientConfig('tok'));
    await waitFor(() => expect(result.current.status).toBe('allowed'));
    expect(edgeCall).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refresh(); });
    expect(edgeCall).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refresh({ force: true }); });
    expect(edgeCall).toHaveBeenCalledTimes(2);
    expect(edgeCall.mock.calls[1][2]).toEqual({ action: 'manifest', platform: 'desktop', deviceRef: 'dev_' + 'b'.repeat(32) });
    await new Promise((r) => setTimeout(r, 50));
    expect(edgeCall).toHaveBeenCalledTimes(2);
  });
});
