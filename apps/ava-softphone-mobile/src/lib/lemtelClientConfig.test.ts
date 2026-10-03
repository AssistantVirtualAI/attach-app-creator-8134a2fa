import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: {} }));

import {
  generateInstallationRef, getInstallationRef, evaluateManifest, parseManifest, saveCachedManifest, loadCachedManifest,
  clearCachedManifest, cacheUsableAfterTransient, foregroundRefreshDue, classifyError, MIN_REFRESH_SECONDS,
} from './lemtelClientConfig';

const NOW = Date.parse('2026-10-03T12:00:00Z');
export function validManifest(over: Record<string, any> = {}) {
  const base: any = {
    schemaVersion: 'lemtel_client_config_manifest_v1',
    identity: { organizationRef: 'org_aaaaaaaaaaaaaaaaaaaaaaaa', domainRef: 'dom_aaaaaaaaaaaaaaaaaaaaaaaa', extensionRef: 'ext_aaaaaaaaaaaaaaaaaaaaaaaa', userRef: 'usr_aaaaaaaaaaaaaaaaaaaaaaaa', privacyScope: 'own_extension_only' },
    access: { mobileEnabled: true, desktopEnabled: false, accountState: 'active', signInMode: 'portal_password' },
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

describe('lemtelClientConfig', () => {
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

  it('refuses disabled mobile, inactive account, non-approved device, actions, edge routing and privacy', () => {
    expect(evaluateManifest(validManifest({ 'access.mobileEnabled': false }), NOW)).toBe('blocked_mobile_access');
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

describe('lemtelClientConfig — Phase 21A.1 strict manifest matrix', () => {
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
    localStorage.setItem('lemtel.mobile.client_config.v1', JSON.stringify({ manifest: validManifest({ 'observability.diagnosticLevel': 'verbose' }), checkedAt: NOW }));
    expect(await loadCachedManifest()).toBeNull();
  });
});
