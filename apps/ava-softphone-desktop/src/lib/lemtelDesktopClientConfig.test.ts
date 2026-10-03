import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Phase 21B.1 — local mocks only; no real Supabase, PBX or device is ever contacted.
const h = vi.hoisted(() => {
  const methods = ['init', 'call', 'answer', 'hangup', 'mute', 'unmute', 'hold', 'unhold', 'sendDTMF', 'blindTransfer',
    'startAttendedConsult', 'completeAttendedTransfer', 'cancelAttendedConsult', 'hasConsult', 'retryNow', 'restart'];
  const sip: any = { listeners: new Set<any>(), snap: { status: 'idle', callState: 'idle' } };
  for (const m of methods) sip[m] = vi.fn(async () => undefined);
  sip.getSnapshot = () => sip.snap;
  sip.subscribe = (cb: any) => { sip.listeners.add(cb); return () => sip.listeners.delete(cb); };
  sip.emit = (s: any) => { sip.snap = s; sip.listeners.forEach((cb: any) => cb(s)); };
  sip.unavailableReason = () => null;
  const auth = {
    setSession: vi.fn(async () => ({})),
    getSession: vi.fn(async () => ({ data: { session: { access_token: 'mock-token' } } })),
  };
  const update = () => ({ eq: async () => ({}) });
  return { sip, auth, supabase: { auth, from: () => ({ update }), functions: { invoke: vi.fn() } } };
});
vi.mock('@/lib/sip/jssipProvider', () => ({ sipProvider: h.sip }));
vi.mock('@/lib/sip/ringtonePlayer', () => ({ ringtone: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: h.supabase, SB_URL: 'https://mock.invalid', SB_KEY: 'mock-key' }));
import { useSoftphone } from '../hooks/useSoftphone';

import {
  generateInstallationRef, getInstallationRef, evaluateManifest, parseManifest, saveCachedManifest, loadCachedManifest,
  clearCachedManifest, cacheUsableAfterTransient, foregroundRefreshDue, classifyError, MIN_REFRESH_SECONDS,
} from './lemtelDesktopClientConfig';

const NOW = Date.parse('2026-10-03T12:00:00Z');
export function validManifest(over: Record<string, any> = {}) {
  const base: any = {
    schemaVersion: 'lemtel_client_config_manifest_v1',
    identity: { organizationRef: 'org_aaaaaaaaaaaaaaaaaaaaaaaa', domainRef: 'dom_aaaaaaaaaaaaaaaaaaaaaaaa', extensionRef: 'ext_aaaaaaaaaaaaaaaaaaaaaaaa', userRef: 'usr_aaaaaaaaaaaaaaaaaaaaaaaa', privacyScope: 'own_extension_only' },
    access: { mobileEnabled: false, desktopEnabled: true, accountState: 'active', signInMode: 'portal_password' },
    revision: { manifestRevision: 'rev_a', issuedAt: '2026-10-03T11:55:00Z', expiresAt: '2026-10-03T12:10:00Z', refreshMode: 'foreground_and_revision_check', revocationBehavior: 'stop_sip_and_clear_local_session' },
    device: { deviceRef: 'dev_' + 'a'.repeat(32), deviceState: 'approved', deviceRevision: 'devrev_a', deviceAction: 'none' },
    telephonyPolicy: { credentialRevisionRef: 'credrev_a', dndState: 'disabled', forwardingState: 'disabled', recordingPolicy: 'portal_managed', voicemailPolicy: 'enabled', callsPrivacyScope: 'own_extension_only', recordingsPrivacyScope: 'own_extension_only', voicemailPrivacyScope: 'own_extension_only', transcriptsPrivacyScope: 'own_extension_only' },
    routing: { routingMode: 'direct_current', routingAssignmentRef: 'route_direct_current_v1', fallbackMode: 'direct_current', edgeFeatureGate: false },
    capabilities: { maestroSyncState: 'disabled', avaCallActionState: 'disabled', avaSmsActionState: 'disabled', microsoftSsoState: 'not_ready' },
    observability: { diagnosticLevel: 'error_only', redactionPolicyRef: 'redact_lemtel_default_v1', supportBundleAllowed: false },
  };
  for (const [path, v] of Object.entries(over)) {
    const [a, b] = path.split('.');
    if (b) base[a][b] = v; else base[a] = v;
  }
  return base;
}

describe('lemtelDesktopClientConfig', () => {
  beforeEach(() => localStorage.clear());

  it('generates opaque refs matching the server pattern and reuses the stored one', async () => {
    for (let i = 0; i < 5; i++) expect(generateInstallationRef()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const a = await getInstallationRef();
    const b = await getInstallationRef();
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('clearing the manifest cache keeps the installation ref', async () => {
    const ref = await getInstallationRef();
    await saveCachedManifest(validManifest(), NOW);
    await clearCachedManifest();
    expect(await loadCachedManifest()).toBeNull();
    expect(await getInstallationRef()).toBe(ref);
  });

  it('valid unexpired manifest is allowed; expired is refused', () => {
    expect(evaluateManifest(validManifest(), NOW)).toBe('allowed');
    expect(evaluateManifest(validManifest(), Date.parse('2026-10-03T12:10:00Z'))).toBe('expired_manifest');
    expect(evaluateManifest(validManifest({ 'revision.expiresAt': 'nope' }), NOW)).toBe('invalid_manifest');
  });

  it('refuses disabled desktop, inactive account, non-approved device, actions, edge routing and privacy', () => {
    expect(evaluateManifest(validManifest({ 'access.desktopEnabled': false }), NOW)).toBe('blocked_desktop_access');
    expect(evaluateManifest(validManifest({ 'access.mobileEnabled': true }), NOW)).toBe('allowed');
    expect(evaluateManifest(validManifest({ 'access.accountState': 'suspended' }), NOW)).toBe('blocked_account');
    expect(evaluateManifest(validManifest({ 'access.accountState': 'disabled' }), NOW)).toBe('blocked_account');
    expect(evaluateManifest(validManifest({ 'device.deviceState': 'pending' }), NOW)).toBe('blocked_device');
    expect(evaluateManifest(validManifest({ 'device.deviceState': 'revoked' }), NOW)).toBe('blocked_device');
    expect(evaluateManifest(validManifest({ 'device.deviceAction': 'refresh_required' }), NOW)).toBe('blocked_device');
    expect(evaluateManifest(validManifest({ 'routing.edgeFeatureGate': true }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'routing.routingMode': 'edge' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'routing.fallbackMode': 'edge' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'identity.privacyScope': 'organization' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'telephonyPolicy.callsPrivacyScope': 'domain' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'revision.revocationBehavior': 'ignore' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ schemaVersion: 'v2' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest({ ...validManifest(), extra: 1 }, NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(null, NOW)).toBe('invalid_manifest');
  });

  it('cache is usable only after a transient failure and only before expiry', async () => {
    await saveCachedManifest(validManifest(), NOW);
    const cached = await loadCachedManifest();
    expect(cacheUsableAfterTransient(cached, NOW)).toBe(true);
    expect(cacheUsableAfterTransient(cached, Date.parse('2026-10-03T12:11:00Z'))).toBe(false);
    expect(cacheUsableAfterTransient(null, NOW)).toBe(false);
    expect(classifyError(new Error('network down'))).toBe('transient_failure');
    expect(classifyError(new Error('device_revoked'))).toBe('blocked_device');
    expect(classifyError(new Error('unauthorized'))).toBe('unauthorized');
  });

  it('900 s threshold prevents a too-early foreground refresh', () => {
    expect(MIN_REFRESH_SECONDS).toBe(900);
    const ref = 'dev_' + 'a'.repeat(32);
    expect(foregroundRefreshDue(ref, NOW, NOW + 899_000)).toBe(false);
    expect(foregroundRefreshDue(ref, NOW, NOW + 900_000)).toBe(true);
    expect(foregroundRefreshDue(null, NOW, NOW + 10_000_000)).toBe(false);
  });

  it('cached object holds no credential, endpoint, contact, call or media data', async () => {
    await saveCachedManifest(validManifest(), NOW);
    const keys = Object.keys(localStorage);
    const raw = keys.map((k) => (k.includes('client_config') ? localStorage.getItem(k) : '')).join('');
    const names = (raw.match(/"[A-Za-z_]+":/g) ?? []).map((k) => k.toLowerCase());
    for (const bad of ['credential"', 'password', 'secret', 'token', 'endpoint', 'host', 'url', 'phone', 'call"', 'recording"', 'voicemail"', 'message', 'cdr', 'media', 'wss', 'extension"', 'domain"']) {
      expect(names.some((n) => n.includes(bad)), bad).toBe(false);
    }
    expect(parseManifest({ ...validManifest(), sipPassword: 'x' })).toBeNull();
  });
});

describe('lemtelDesktopClientConfig — Phase 21B strict manifest matrix', () => {
  const inv = (over: Record<string, any>) => expect(evaluateManifest(validManifest(over), NOW), JSON.stringify(over)).toBe('invalid_manifest');
  const REFS = ['identity.organizationRef', 'identity.domainRef', 'identity.extensionRef', 'identity.userRef', 'revision.manifestRevision', 'device.deviceRevision', 'telephonyPolicy.credentialRevisionRef', 'routing.routingAssignmentRef', 'observability.redactionPolicyRef'];
  const BAD_REFS = ['Org_ABC', 'ab', 'org abc', 'https://x.example/a', 'a@b.example', '', '_abc', 'a'.repeat(65), 12345, null];

  it('conforming manifest stays allowed', () => {
    expect(evaluateManifest(validManifest(), NOW)).toBe('allowed');
    expect(parseManifest(validManifest())).not.toBeNull();
    expect(evaluateManifest(validManifest({ 'revision.issuedAt': '2026-10-03T11:55:00.1Z', 'revision.expiresAt': '2026-10-03T12:10:00.123Z' }), NOW)).toBe('allowed');
  });

  it('rejects every invalid opaque reference in every position', () => {
    for (const k of REFS) for (const v of BAD_REFS) inv({ [k]: v });
    for (const v of ['dev_' + 'A'.repeat(32), 'dev_' + 'a'.repeat(31), 'dev-' + 'a'.repeat(32)]) inv({ 'device.deviceRef': v });
  });

  it('rejects non-strict UTC dates', () => {
    for (const k of ['revision.issuedAt', 'revision.expiresAt']) {
      for (const v of ['2026-10-03T12:10:00', '2026-10-03T12:10:00+00:00', '2026-10-03T08:10:00-04:00', '2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-10-03T24:00:00Z', '2026-10-03T12:10:00.1234Z', '2026-10-03 12:10:00Z', 'nope', '', 1791000000000, null]) inv({ [k]: v });
    }
  });

  it('rejects unknown enum values', () => {
    for (const [k, v] of [['access.signInMode', 'magic_link'], ['access.accountState', 'locked'], ['revision.refreshMode', 'always'], ['device.deviceState', 'unknown'], ['device.deviceAction', 'wipe'], ['telephonyPolicy.dndState', 'on'], ['telephonyPolicy.forwardingState', 'on'], ['telephonyPolicy.recordingPolicy', 'always'], ['telephonyPolicy.voicemailPolicy', 'on'], ['observability.diagnosticLevel', 'verbose'], ['access.mobileEnabled', 'true'], ['access.desktopEnabled', 1]] as const) inv({ [k]: v });
  });

  it('capabilities require exactly four keys with known enums', () => {
    const caps = validManifest().capabilities;
    for (const k of Object.keys(caps)) {
      const { [k]: _omit, ...rest } = caps;
      inv({ capabilities: rest });
      inv({ capabilities: { ...caps, [k]: 'enabled_now' } });
    }
    inv({ capabilities: {} });
    inv({ capabilities: { ...caps, extraState: 'disabled' } });
    inv({ capabilities: { maestroSyncState: 'disabled' } });
  });

  it('every sub-object rejects a missing or an extra key', () => {
    const base = validManifest();
    for (const obj of ['identity', 'access', 'revision', 'device', 'telephonyPolicy', 'routing', 'capabilities', 'observability']) {
      inv({ [obj]: { ...base[obj], unexpectedKey: 'x' } });
      for (const k of Object.keys(base[obj])) {
        const { [k]: _omit, ...rest } = base[obj];
        inv({ [obj]: rest });
      }
      inv({ [obj]: [] });
      inv({ [obj]: null });
    }
  });

  it('every privacy scope must be own_extension_only', () => {
    for (const k of ['identity.privacyScope', 'telephonyPolicy.callsPrivacyScope', 'telephonyPolicy.recordingsPrivacyScope', 'telephonyPolicy.voicemailPrivacyScope', 'telephonyPolicy.transcriptsPrivacyScope']) {
      for (const v of ['organization', 'domain', '', null]) inv({ [k]: v });
    }
  });

  it('routing must be direct_current with edge gate false', () => {
    for (const v of ['edge', 'edge_shadow', '', null]) { inv({ 'routing.routingMode': v }); inv({ 'routing.fallbackMode': v }); }
    for (const v of [true, 'false', 0, null]) inv({ 'routing.edgeFeatureGate': v });
  });

  it('observability: supportBundleAllowed boolean and valid redaction ref', () => {
    for (const v of ['false', 0, null]) inv({ 'observability.supportBundleAllowed': v });
    inv({ 'observability.redactionPolicyRef': 'Redact Default' });
  });

  it('parseManifest returns null for every rejected mutation (never reaches allowed)', () => {
    expect(parseManifest(validManifest({ 'access.signInMode': 'x' }))).toBeNull();
    expect(parseManifest(validManifest({ 'revision.expiresAt': '2026-10-03T12:10:00+00:00' }))).toBeNull();
  });

  it('conforming cache stays usable only after a transient error; invalid cache is never loaded', async () => {
    localStorage.clear();
    await saveCachedManifest(validManifest(), NOW);
    expect(cacheUsableAfterTransient(await loadCachedManifest(), NOW)).toBe(true);
    await saveCachedManifest(validManifest({ 'capabilities.maestroSyncState': 'go' }), NOW);
    localStorage.setItem('lemtel.desktop.client_config.v1', JSON.stringify({ manifest: validManifest({ 'observability.diagnosticLevel': 'verbose' }), checkedAt: NOW }));
    expect(await loadCachedManifest()).toBeNull();
  });
});

describe('lemtelDesktopClientConfig — Phase 21B desktop specifics', () => {
  beforeEach(() => localStorage.clear());
  it('installation ref uses the exact desktop key and survives manifest clearing', async () => {
    const ref = await getInstallationRef();
    expect(localStorage.getItem('lemtel.desktop.installation_ref.v1')).toBe(ref);
    await saveCachedManifest(validManifest(), NOW);
    expect(localStorage.getItem('lemtel.desktop.client_config.v1')).not.toBeNull();
    await clearCachedManifest();
    expect(localStorage.getItem('lemtel.desktop.client_config.v1')).toBeNull();
    expect(localStorage.getItem('lemtel.desktop.installation_ref.v1')).toBe(ref);
  });
  it('maps public block codes to desktop decisions', () => {
    expect(classifyError(new Error('platform_access_disabled'))).toBe('blocked_desktop_access');
    expect(classifyError(new Error('app_access_disabled'))).toBe('blocked_desktop_access');
    expect(classifyError(new Error('no_softphone_account'))).toBe('blocked_account');
  });
  it('storage failures never throw', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try { expect(await loadCachedManifest()).toBeNull(); } finally { spy.mockRestore(); }
  });
});

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const CREDS = { extension: '100', display_name: 'X', sip_domain: 'mock.invalid', wss_url: 'wss://mock.invalid', password: 'mock' };

describe('Phase 21B.1 — useSoftphone async races during revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sip.snap = { status: 'idle', callState: 'idle' };
    h.sip.listeners.clear();
  });

  it('credential fetch in flight: revocation before resolve never reaches sipProvider.init nor retries', async () => {
    const d = deferred<Response>();
    const fetchMock = vi.fn(() => d.promise);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { rerender } = renderHook((p: { allow: boolean }) => useSoftphone({ extension: '100', accessToken: 't', allowNewActions: p.allow }), { initialProps: { allow: true } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(String(fetchMock.mock.calls[0][0])).toContain('softphone-credentials');
      rerender({ allow: false });
      await act(async () => { d.resolve(okJson(CREDS)); await Promise.resolve(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(h.sip.init).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('auto-heal in flight: revocation before resolve schedules no retry / re-registration', async () => {
    const heal = deferred<Response>();
    const fetchMock = vi.fn((url: string) => (String(url).includes('softphone-sync-password') ? heal.promise : Promise.resolve(okJson(CREDS))));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { rerender } = renderHook((p: { allow: boolean }) => useSoftphone({ extension: '100', accessToken: 't', allowNewActions: p.allow }), { initialProps: { allow: true } });
      await waitFor(() => expect(h.sip.init).toHaveBeenCalledTimes(1));
      act(() => h.sip.emit({ status: 'error', callState: 'idle', errorCause: '403 Forbidden' }));
      await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('softphone-sync-password'))).toBe(true));
      rerender({ allow: false });
      const credCallsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('softphone-credentials')).length;
      await act(async () => { heal.resolve(okJson({ ok: true })); await new Promise((r) => setTimeout(r, 20)); });
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('softphone-credentials')).length).toBe(credCallsBefore);
      expect(h.sip.init).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('blocked: transfers refused; existing-call controls still routed to the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { result } = renderHook(() => useSoftphone({ extension: '100', accessToken: 't', allowNewActions: false }));
      act(() => {
        result.current.blindTransfer('200');
        result.current.startAttendedConsult('200');
        result.current.completeAttendedTransfer();
      });
      expect(h.sip.blindTransfer).not.toHaveBeenCalled();
      expect(h.sip.startAttendedConsult).not.toHaveBeenCalled();
      expect(h.sip.completeAttendedTransfer).not.toHaveBeenCalled();
      act(() => {
        result.current.answer(); result.current.hangup(); result.current.mute(); result.current.unmute();
        result.current.hold(); result.current.unhold(); result.current.sendDTMF('1'); result.current.cancelAttendedConsult();
      });
      for (const m of ['answer', 'hangup', 'mute', 'unmute', 'hold', 'unhold', 'sendDTMF', 'cancelAttendedConsult']) expect(h.sip[m], m).toHaveBeenCalledTimes(1);
      expect(h.sip.init).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('Phase 22C: the four portal policy values are validated; unknown recording/voicemail refused', () => {
    for (const r of ['not_allowed', 'user_allowed', 'portal_managed']) expect(evaluateManifest(validManifest({ 'telephonyPolicy.recordingPolicy': r }), NOW)).toBe('allowed');
    for (const v of ['enabled', 'disabled']) {
      expect(evaluateManifest(validManifest({ 'telephonyPolicy.dndState': v, 'telephonyPolicy.forwardingState': v, 'telephonyPolicy.voicemailPolicy': v }), NOW)).toBe('allowed');
    }
    expect(evaluateManifest(validManifest({ 'telephonyPolicy.recordingPolicy': 'always' }), NOW)).toBe('invalid_manifest');
    expect(evaluateManifest(validManifest({ 'telephonyPolicy.voicemailPolicy': 'maybe' }), NOW)).toBe('invalid_manifest');
    const typed: import('./lemtelDesktopClientConfig').LemtelManifest['telephonyPolicy']['recordingPolicy'] = 'portal_managed';
    expect(typed).toBe('portal_managed');
  });
});
