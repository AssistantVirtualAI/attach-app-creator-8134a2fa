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
