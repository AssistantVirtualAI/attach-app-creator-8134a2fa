// Lemtel Phase 21B — Desktop device lifecycle (pure module, no React, no network).
// The portal stays the authority. This module only:
//  - keeps a stable opaque installation reference (never cleared on sign-out / block),
//  - validates the non-sensitive lifecycle manifest strictly,
//  - caches the last safe manifest (no session or telephony data),
//  - decides when a foreground refresh is due (minimum 900 s).

const INSTALLATION_KEY = 'lemtel.desktop.installation_ref.v1';
const MANIFEST_KEY = 'lemtel.desktop.client_config.v1';
const INSTALLATION_RE = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_REF_RE = /^dev_[0-9a-f]{32}$/;
const OWN = 'own_extension_only';
const REVOKE_BEHAVIOR = 'stop_sip_and_clear_local_session';
export const SCHEMA_VERSION = 'lemtel_client_config_manifest_v1';
export const MIN_REFRESH_SECONDS = 900;

export type LifecycleDecision =
  | 'allowed'
  | 'blocked_desktop_access'
  | 'blocked_account'
  | 'blocked_device'
  | 'invalid_manifest'
  | 'expired_manifest'
  | 'transient_failure';

export type LemtelManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  identity: { organizationRef: string; domainRef: string; extensionRef: string; userRef: string; privacyScope: typeof OWN };
  access: { mobileEnabled: boolean; desktopEnabled: boolean; accountState: 'active' | 'suspended' | 'disabled'; signInMode: string };
  revision: { manifestRevision: string; issuedAt: string; expiresAt: string; refreshMode: string; revocationBehavior: typeof REVOKE_BEHAVIOR };
  device: { deviceRef: string; deviceState: 'approved' | 'pending' | 'revoked'; deviceRevision: string; deviceAction: 'none' | 'refresh_required' | 'revoke_required' };
  telephonyPolicy: {
    credentialRevisionRef: string; dndState: 'enabled' | 'disabled'; forwardingState: 'enabled' | 'disabled';
    recordingPolicy: string; voicemailPolicy: string;
    callsPrivacyScope: typeof OWN; recordingsPrivacyScope: typeof OWN; voicemailPrivacyScope: typeof OWN; transcriptsPrivacyScope: typeof OWN;
  };
  routing: { routingMode: 'direct_current'; routingAssignmentRef: string; fallbackMode: 'direct_current'; edgeFeatureGate: false };
  capabilities: Record<string, string>;
  observability: { diagnosticLevel: string; redactionPolicyRef: string; supportBundleAllowed: boolean };
};

// Cache entry: only the safe manifest plus the local time of the last successful check.
export type CachedLifecycle = { manifest: LemtelManifest; checkedAt: number };

// ---------- storage helpers (local storage, guarded for Electron/test) ----------
function store(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
async function readKey(key: string): Promise<string | null> {
  try { return store()?.getItem(key) ?? null; } catch { return null; }
}
async function writeKey(key: string, value: string): Promise<void> {
  try { store()?.setItem(key, value); } catch { /* ignore */ }
}
async function removeKey(key: string): Promise<void> {
  try { store()?.removeItem(key); } catch { /* ignore */ }
}

// ---------- installation reference ----------
export function generateInstallationRef(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return String(c.randomUUID()).replace(/-/g, '');
  if (c?.getRandomValues) {
    const b = new Uint8Array(24);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  let s = '';
  while (s.length < 48) s += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return s.slice(0, 48);
}

/** Returns the stable installation reference, creating it once. Never logged, displayed or cleared. */
export async function getInstallationRef(): Promise<string> {
  const existing = await readKey(INSTALLATION_KEY);
  if (existing && INSTALLATION_RE.test(existing)) return existing;
  const ref = generateInstallationRef();
  await writeKey(INSTALLATION_KEY, ref);
  return ref;
}

// ---------- strict validation ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: string[]) => {
  const k = Object.keys(o).sort();
  return k.length === keys.length && [...keys].sort().every((x, i) => x === k[i]);
};

// Phase 21A.1 hardening: every Phase 16 key, pattern, UTC date and enum is enforced.
const OPAQUE_REF_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const UTC_Z_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const ref = (v: unknown) => typeof v === 'string' && OPAQUE_REF_RE.test(v);
const oneOf = (v: unknown, allowed: readonly string[]) => typeof v === 'string' && allowed.includes(v);
const bool = (v: unknown) => typeof v === 'boolean';
/** Strict ISO UTC (Z only, 0-3 decimals), real calendar date. */
export function isStrictUtc(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const m = UTC_Z_RE.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return false;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return false;
  return Number.isFinite(Date.parse(v));
}
const ACCOUNT_STATES = ['active', 'suspended', 'disabled'] as const;
const SIGN_IN_MODES = ['portal_password', 'microsoft_sso', 'portal_password_or_microsoft_sso'] as const;
const REFRESH_MODES = ['foreground_and_revision_check', 'manual_only', 'disabled'] as const;
const DEVICE_STATES = ['approved', 'pending', 'revoked'] as const;
const DEVICE_ACTIONS = ['none', 'refresh_required', 'revoke_required'] as const;
const ON_OFF = ['enabled', 'disabled'] as const;
const RECORDING_POLICIES = ['not_allowed', 'user_allowed', 'portal_managed'] as const;
const DIAGNOSTIC_LEVELS = ['off', 'error_only', 'standard'] as const;
const CAPABILITY_ENUMS: Record<string, readonly string[]> = {
  maestroSyncState: ['disabled', 'not_ready', 'ready'],
  avaCallActionState: ['disabled', 'not_ready', 'requires_user_confirmation'],
  avaSmsActionState: ['disabled', 'not_ready', 'requires_user_confirmation'],
  microsoftSsoState: ['disabled', 'not_ready', 'ready'],
};

/** Strict Phase 16 contract check. Returns the typed manifest or null. */
export function parseManifest(raw: unknown): LemtelManifest | null {
  if (!isObj(raw)) return null;
  if (!exactKeys(raw, ['schemaVersion', 'identity', 'access', 'revision', 'device', 'telephonyPolicy', 'routing', 'capabilities', 'observability'])) return null;
  const { identity: id, access: ac, revision: rv, device: dv, telephonyPolicy: tp, routing: ro, capabilities: ca, observability: ob } = raw;
  if (raw.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isObj(id) || !exactKeys(id, ['organizationRef', 'domainRef', 'extensionRef', 'userRef', 'privacyScope'])) return null;
  if (![id.organizationRef, id.domainRef, id.extensionRef, id.userRef].every(ref) || id.privacyScope !== OWN) return null;
  if (!isObj(ac) || !exactKeys(ac, ['mobileEnabled', 'desktopEnabled', 'accountState', 'signInMode'])) return null;
  if (!bool(ac.mobileEnabled) || !bool(ac.desktopEnabled) || !oneOf(ac.accountState, ACCOUNT_STATES) || !oneOf(ac.signInMode, SIGN_IN_MODES)) return null;
  if (!isObj(rv) || !exactKeys(rv, ['manifestRevision', 'issuedAt', 'expiresAt', 'refreshMode', 'revocationBehavior'])) return null;
  if (!ref(rv.manifestRevision) || !isStrictUtc(rv.issuedAt) || !isStrictUtc(rv.expiresAt) || !oneOf(rv.refreshMode, REFRESH_MODES) || rv.revocationBehavior !== REVOKE_BEHAVIOR) return null;
  if (!isObj(dv) || !exactKeys(dv, ['deviceRef', 'deviceState', 'deviceRevision', 'deviceAction'])) return null;
  if (typeof dv.deviceRef !== 'string' || !DEVICE_REF_RE.test(dv.deviceRef) || !ref(dv.deviceRevision)) return null;
  if (!oneOf(dv.deviceState, DEVICE_STATES) || !oneOf(dv.deviceAction, DEVICE_ACTIONS)) return null;
  if (!isObj(tp) || !exactKeys(tp, ['credentialRevisionRef', 'dndState', 'forwardingState', 'recordingPolicy', 'voicemailPolicy', 'callsPrivacyScope', 'recordingsPrivacyScope', 'voicemailPrivacyScope', 'transcriptsPrivacyScope'])) return null;
  if (!ref(tp.credentialRevisionRef) || !oneOf(tp.dndState, ON_OFF) || !oneOf(tp.forwardingState, ON_OFF) || !oneOf(tp.recordingPolicy, RECORDING_POLICIES) || !oneOf(tp.voicemailPolicy, ON_OFF)) return null;
  if (tp.callsPrivacyScope !== OWN || tp.recordingsPrivacyScope !== OWN || tp.voicemailPrivacyScope !== OWN || tp.transcriptsPrivacyScope !== OWN) return null;
  if (!isObj(ro) || !exactKeys(ro, ['routingMode', 'routingAssignmentRef', 'fallbackMode', 'edgeFeatureGate'])) return null;
  if (ro.routingMode !== 'direct_current' || ro.fallbackMode !== 'direct_current' || ro.edgeFeatureGate !== false || !ref(ro.routingAssignmentRef)) return null;
  if (!isObj(ca) || !exactKeys(ca, Object.keys(CAPABILITY_ENUMS))) return null;
  if (!Object.entries(CAPABILITY_ENUMS).every(([k, allowed]) => oneOf(ca[k], allowed))) return null;
  if (!isObj(ob) || !exactKeys(ob, ['diagnosticLevel', 'redactionPolicyRef', 'supportBundleAllowed'])) return null;
  if (!oneOf(ob.diagnosticLevel, DIAGNOSTIC_LEVELS) || !ref(ob.redactionPolicyRef) || !bool(ob.supportBundleAllowed)) return null;
  return raw as unknown as LemtelManifest;
}

/** Full policy decision. Only "allowed" permits starting telephony. */
export function evaluateManifest(raw: unknown, now: number = Date.now()): LifecycleDecision {
  const m = parseManifest(raw);
  if (!m) return 'invalid_manifest';
  const t = m.telephonyPolicy;
  if (m.identity.privacyScope !== OWN || t.callsPrivacyScope !== OWN || t.recordingsPrivacyScope !== OWN || t.voicemailPrivacyScope !== OWN || t.transcriptsPrivacyScope !== OWN) return 'invalid_manifest';
  if (m.routing.routingMode !== 'direct_current' || m.routing.fallbackMode !== 'direct_current' || m.routing.edgeFeatureGate !== false) return 'invalid_manifest';
  if (m.revision.revocationBehavior !== REVOKE_BEHAVIOR) return 'invalid_manifest';
  const exp = Date.parse(m.revision.expiresAt);
  if (!Number.isFinite(exp)) return 'invalid_manifest';
  if (m.access.desktopEnabled !== true) return 'blocked_desktop_access';
  if (m.access.accountState !== 'active') return 'blocked_account';
  if (m.device.deviceState !== 'approved' || m.device.deviceAction !== 'none') return 'blocked_device';
  if (exp <= now) return 'expired_manifest';
  return 'allowed';
}

// Server error codes that mean "access is no longer granted".
const BLOCK_CODES: Record<string, LifecycleDecision> = {
  device_revoked: 'blocked_device',
  platform_access_disabled: 'blocked_desktop_access',
  app_access_disabled: 'blocked_desktop_access',
  no_softphone_account: 'blocked_account',
};
/** Maps a thrown server error to a stable decision. Never returns the raw message. */
export function classifyError(err: unknown): LifecycleDecision | 'unauthorized' {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (Object.prototype.hasOwnProperty.call(BLOCK_CODES, msg)) return BLOCK_CODES[msg];
  if (msg === 'unauthorized' || /\b401\b/.test(msg)) return 'unauthorized';
  return 'transient_failure';
}

// ---------- non-sensitive manifest cache ----------
export async function loadCachedManifest(): Promise<CachedLifecycle | null> {
  const raw = await readKey(MANIFEST_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    const manifest = parseManifest(p?.manifest);
    if (!manifest || typeof p?.checkedAt !== 'number') return null;
    return { manifest, checkedAt: p.checkedAt };
  } catch { return null; }
}
export async function saveCachedManifest(manifest: LemtelManifest, checkedAt: number = Date.now()): Promise<void> {
  if (!parseManifest(manifest)) return;
  await writeKey(MANIFEST_KEY, JSON.stringify({ manifest, checkedAt }));
}
/** Clears only the manifest cache. The installation reference is intentionally kept. */
export async function clearCachedManifest(): Promise<void> {
  await removeKey(MANIFEST_KEY);
}

/** A cached manifest may be used only after a transient failure and only before it expires. */
export function cacheUsableAfterTransient(cached: CachedLifecycle | null, now: number = Date.now()): boolean {
  return !!cached && evaluateManifest(cached.manifest, now) === 'allowed';
}

/** Foreground refresh rule: only with a known deviceRef and after at least 900 s since the last success. */
export function foregroundRefreshDue(deviceRef: string | null, lastSuccessAt: number | null, now: number = Date.now()): boolean {
  if (!deviceRef || lastSuccessAt === null) return false;
  return now - lastSuccessAt >= MIN_REFRESH_SECONDS * 1000;
}
