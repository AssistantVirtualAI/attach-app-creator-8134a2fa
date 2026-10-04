import { BACKEND_URL, BACKEND_ANON_KEY, BACKEND_STORAGE_SUFFIX } from './backendOrigin';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Preferences } from '@capacitor/preferences';
import { supabase, clearRecordingAudioCache } from './mobileSupabase';
import { clearRecordingCache } from './recordingCache';
import { clearIceServerCache } from './sip/iceServers';
import { setAuthToken } from './mobileApi';

export type Creds = {
  portalUrl?: string;
  backendOrigin?: string;
  email: string;
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  wssUrls?: string[];
  sipPassword?: string;
  authUsername?: string;
  passwordSource?: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  organizationId?: string;
  organizationName?: string;
  fusionpbxDomainUuid?: string;
  domainUuid?: string;
  role?: 'super_admin' | 'org_admin' | 'manager' | 'agent' | 'viewer';
  dataScope?: 'domain_admin' | 'extension_user';
  permissions?: { admin: boolean; canManageNumbers?: boolean; canManageAgents?: boolean; canManageUsers?: boolean; canManageRouting?: boolean; canViewDomainReports?: boolean };
};


const KEY = `lemtel.creds.v1${BACKEND_STORAGE_SUFFIX}`;
let legacyCleared = false;
let credentialEpoch = 0;
let storageQueue: Promise<void> = Promise.resolve();
let authQueue: Promise<void> = Promise.resolve();

function ordered<T>(queue: 'storage' | 'auth', action: () => Promise<T>): Promise<T> {
  const previous = queue === 'storage' ? storageQueue : authQueue;
  const task = previous.then(action, action);
  const settled = task.then(() => {}, () => {});
  if (queue === 'storage') storageQueue = settled;
  else authQueue = settled;
  return task;
}

export function isCurrentCredentialEpoch(epoch: number): boolean { return epoch === credentialEpoch; }
export function getCredentialEpoch(): number { return credentialEpoch; }

/** One owner of Supabase session restoration; logout is queued after any in-flight restore. */
export function restoreSupabaseSession(c: Creds): Promise<{ access_token: string; refresh_token: string; user: { id: string } } | null> {
  const epoch = credentialEpoch;
  return ordered('auth', async () => {
    if (epoch !== credentialEpoch || !c.userId || !c.accessToken || !c.refreshToken ||
        (c.backendOrigin && c.backendOrigin !== BACKEND_URL)) return null;
    const usable = async (candidate: any) => {
      if (!candidate || candidate.user?.id !== c.userId) return null;
      if (!candidate.expires_at || candidate.expires_at * 1000 <= Date.now() + 5_000) {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || epoch !== credentialEpoch || data.session?.user?.id !== c.userId ||
            !data.session?.expires_at || data.session.expires_at * 1000 <= Date.now()) return null;
        return data.session;
      }
      return epoch === credentialEpoch ? candidate : null;
    };
    const { data: existing } = await supabase.auth.getSession();
    if (epoch !== credentialEpoch) return null;
    if (existing.session?.user?.id === c.userId) return usable(existing.session);
    if (existing.session?.user?.id) return null;
    const { data, error } = await supabase.auth.setSession({ access_token: c.accessToken, refresh_token: c.refreshToken });
    if (epoch !== credentialEpoch || error || data.session?.user?.id !== c.userId) return null;
    return usable(data.session);
  });
}

async function clearLegacySessionOnCutover(): Promise<void> {
  if (!BACKEND_STORAGE_SUFFIX || legacyCleared) return;
  legacyCleared = true;
  for (const key of ['lemtel.creds.v1', 'lemtel-mobile-auth']) {
    try { await Preferences.remove({ key }); } catch { /* no native storage */ }
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* private mode */ }
  }
}

function signOutSupabaseSession(): Promise<void> {
  return ordered('auth', async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) await supabase.auth.signOut({ scope: 'local' });
    } catch {
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* no active SDK session */ }
    }
  });
}

// Lightweight Preferences shim — uses Capacitor when native, localStorage on web preview.
export const Store = {
  async get(): Promise<Creds | null> {
    return ordered('storage', async () => {
      await clearLegacySessionOnCutover();
      try {
        if ((Preferences as any)?.get) {
          const { value } = await Preferences.get({ key: KEY });
          if (value) {
            const parsed = JSON.parse(value) as Creds;
            return !BACKEND_STORAGE_SUFFIX || parsed.backendOrigin === BACKEND_URL ? parsed : null;
          }
        }
      } catch {}
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      try {
        const parsed = v ? JSON.parse(v) as Creds : null;
        return parsed && BACKEND_STORAGE_SUFFIX && parsed.backendOrigin !== BACKEND_URL ? null : parsed;
      } catch { return null; }
    });
  },
  async set(c: Creds, expectedEpoch = credentialEpoch): Promise<void> {
    return ordered('storage', async () => {
      if (expectedEpoch !== credentialEpoch) return;
      const v = JSON.stringify({ ...c, backendOrigin: BACKEND_URL });
      try {
        if ((Preferences as any)?.set) {
          await Preferences.set({ key: KEY, value: v });
          if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
          return;
        }
      } catch {}
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v);
    });
  },
  async clear(): Promise<void> {
    credentialEpoch++;
    return ordered('storage', async () => {
      try {
        if ((Preferences as any)?.remove) {
          await Preferences.remove({ key: KEY });
        }
      } catch {}
      if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
    });
  },
};

export const saveCredentials = (c: Creds) => Store.set(c);
export const getCredentials = () => Store.get();
export const clearCredentials = () => Store.clear();

export function useStoredCreds() {
  const [creds, setCredsState] = useState<Creds | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const clearingRef = useRef(false);
  const credsRef = useRef<Creds | null>(null);

  useEffect(() => {
    const epoch = credentialEpoch;
    Store.get().then((c) => {
      if (epoch !== credentialEpoch) return;
      credsRef.current = c;
      setCredsState(c);
    }).finally(() => setLoading(false));
  }, []);

  const setCreds = useCallback((c: Creds | ((prev: Creds | null) => Creds)) => {
    if (clearingRef.current) return;
    const previous = credsRef.current;
    if (typeof c === 'function' && !previous) return;
    const next = typeof c === 'function' ? c(previous) : c;
    // Only an explicit sign-out can precede a different account's login.
    if (previous?.userId && next.userId && previous.userId !== next.userId) return;
    credsRef.current = next;
    setCredsState(next);
    void Store.set(next).catch(() => {});
  }, []);

  const clearCreds = useCallback(() => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    // Lock media immediately, before asynchronous native disk cleanup or
    // remote refresh-token revocation completes.
    clearRecordingAudioCache();
    clearIceServerCache();
    setAuthToken(null);
    setSigningOut(true);
    credsRef.current = null;
    setCredsState(null);
    const storage = Store.clear();
    void Promise.allSettled([storage, signOutSupabaseSession(), clearRecordingCache()])
      .finally(() => { clearingRef.current = false; setSigningOut(false); });
  }, []);

  return { creds, setCreds, clearCreds, loading: loading || signingOut };
}

/**
 * Best-effort resolver for the user's organizationId. Falls back to user_roles
 * via the Supabase REST API when stored credentials are missing the field
 * (e.g. legacy sessions or email-only sign-in before this fix).
 * Persists the resolved value back into Store so subsequent calls are instant.
 */
const SUPABASE_URL_DEF = BACKEND_URL;
const SUPABASE_ANON_DEF = BACKEND_ANON_KEY;

export async function fetchOrganizationIdForUser(accessToken: string, userId: string): Promise<string | null> {
  if (!accessToken || !userId) return null;
  try {
    const url = `${SUPABASE_URL_DEF}/rest/v1/user_roles?user_id=eq.${userId}&select=organization_id&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_DEF, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return rows?.[0]?.organization_id || null;
  } catch { return null; }
}

/** Resolve + persist organizationId for the currently stored creds. Returns the resolved id. */
export async function ensureStoredOrganizationId(): Promise<string | null> {
  const c = await Store.get();
  const epoch = credentialEpoch;
  if (!c) return null;
  if (c.organizationId) return c.organizationId;
  if (!c.accessToken || !c.userId) return null;
  const orgId = await fetchOrganizationIdForUser(c.accessToken, c.userId);
  if (epoch !== credentialEpoch) return null;
  if (orgId) await Store.set({ ...c, organizationId: orgId }, epoch);
  return epoch === credentialEpoch ? orgId : null;
}

/**
 * Hydrate full SIP credentials from softphone-credentials edge function.
 * Used after email-only login (no extension) and on boot for legacy sessions
 * missing extension/sipDomain/wssUrl/sipPassword. Returns the updated creds
 * (or null if hydration failed / user has no softphone account).
 */
export async function hydrateSoftphoneCredentials(platform: 'mobile' | 'desktop' = 'mobile'): Promise<Creds | null> {
  const c = await Store.get();
  const epoch = credentialEpoch;
  if (!c?.accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL_DEF}/functions/v1/softphone-credentials?platform=${platform}`, {
      headers: { apikey: SUPABASE_ANON_DEF, Authorization: `Bearer ${c.accessToken}` },
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null) as any;
    if (epoch !== credentialEpoch) return null;
    if (!d || d.error || !d.extension) return null;
    const next: Creds = {
      ...c,
      extension: d.extension || c.extension || '',
      displayName: d.display_name || d.displayName || c.displayName,
      sipDomain: d.sip_domain || d.sipDomain || c.sipDomain,
      wssUrl: d.wss_url || d.wssUrl || c.wssUrl,
      wssUrls: d.wss_urls || d.wssUrls || c.wssUrls,
      sipPassword: d.sip_password || d.password || c.sipPassword,
      authUsername: d.auth_username || d.authUsername || d.extension || c.authUsername,
      passwordSource: d.password_source || d.passwordSource || c.passwordSource,
      organizationId: d.organization_id || c.organizationId,
      organizationName: d.organization_name || c.organizationName,
      fusionpbxDomainUuid: d.fusionpbx_domain_uuid || c.fusionpbxDomainUuid,
      domainUuid: d.fusionpbx_domain_uuid || c.domainUuid,
      role: d.role || c.role,
      dataScope: d.data_scope || c.dataScope,
      portalUrl: d.portal_url || c.portalUrl,
    };
    await Store.set(next, epoch);
    return epoch === credentialEpoch ? next : null;
  } catch { return null; }
}
