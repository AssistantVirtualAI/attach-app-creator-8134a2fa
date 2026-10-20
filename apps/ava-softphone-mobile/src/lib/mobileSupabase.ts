import { LemtelPbxError, lemtelPbxFetch } from './lemtelPbxMobile';
import { BACKEND_URL, BACKEND_ANON_KEY, BACKEND_STORAGE_SUFFIX } from './backendOrigin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

export const SUPABASE_URL = BACKEND_URL;

export const SUPABASE_ANON = BACKEND_ANON_KEY;

// Capacitor Preferences-backed storage so the SDK can persist and refresh
// sessions across native app restarts (where localStorage is unreliable).
const nativeStorage = {
  getItem: async (key: string) => {
    try {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    } catch { return null; }
  },
  setItem: async (key: string, value: string) => {
    try { await Preferences.set({ key, value }); } catch {}
  },
  removeItem: async (key: string) => {
    try { await Preferences.remove({ key }); } catch {}
  },
};

const webStorage = typeof window !== 'undefined' && window.localStorage
  ? window.localStorage
  : undefined;

let _mobileClient: SupabaseClient | null = null;
export function getMobileSupabaseClient(): SupabaseClient {
  if (_mobileClient) return _mobileClient;
  _mobileClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: `lemtel-mobile-auth${BACKEND_STORAGE_SUFFIX}`,
      storage: (Capacitor.isNativePlatform() ? nativeStorage : webStorage) as any,
    },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  return _mobileClient;
}

export const supabase = getMobileSupabaseClient();

export function authedRealtime(token?: string | null) {
  const sb = getMobileSupabaseClient();
  if (token) sb.realtime.setAuth(token);
  return sb;
}

export async function restGet<T = any>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json().catch(() => null) as Promise<T>;
}

export async function restPost<T = any>(path: string, token: string | null | undefined, body: any): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      apikey: SUPABASE_ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json().catch(() => null) as Promise<T>;
}

export async function edgeCall<T = any>(functionName: string, token: string | null | undefined, body: any): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed?.error || parsed?.message || `HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof Error && err.message !== text) throw err;
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  return res.json().catch(() => null) as Promise<T>;
}

type RecordingMeta = {
  id?: string | null;
  pbx_uuid?: string | null;
  xml_cdr_uuid?: string | null;
  recording_path?: string | null;
  recording_name?: string | null;
  record_path?: string | null;
  record_name?: string | null;
  domain_uuid?: string | null;
  domain_name?: string | null;
  organization_id?: string | null;
  start_at?: string | null;
  recorded_at?: string | null;
  recording_url?: string | null;
};

const clean = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '';
};

// A server-signed bearer URL must not outlive the current mobile session.
// Never cache it by CDR alone: the same device can switch user or extension.
let audioEpoch = 0;
export function clearRecordingAudioCache() { audioEpoch++; }

/**
 * Get a fresh JWT token from the Supabase session.
 * Refreshes proactively if the token is expired or close to expiry (< 60s).
 * Never falls back to caller-supplied/stored credentials after sign-out.
 */
async function getFreshSession() {
  const sb = getMobileSupabaseClient();
  let { data: { session } } = await sb.auth.getSession();
  if (!session?.user?.id) throw new Error('Session expirée. Reconnectez-vous pour écouter les enregistrements.');
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - nowSec < 60) {
    const { data: refreshed, error } = await sb.auth.refreshSession();
    if (error || !refreshed?.session?.user?.id) throw new Error('Session expirée. Reconnectez-vous pour écouter les enregistrements.');
    session = refreshed.session;
  }
  return session;
}

export async function loadPbxRecordingAudioMobile(
  recording: RecordingMeta,
  _token?: string | null,
  _organizationId?: string | null,
  _fallbackDomainUuid?: string | null,
  _opts?: { skipCache?: boolean },
) {
  const xml_cdr_uuid = clean(recording.xml_cdr_uuid || recording.pbx_uuid || recording.id);
  if (!xml_cdr_uuid) throw new Error('Missing CDR identifier');
  const requestEpoch = audioEpoch;
  const initialSession = await getFreshSession();
  let freshToken = initialSession.access_token;
  const userId = initialSession.user.id;
  const assertCurrentSession = async () => {
    if (requestEpoch !== audioEpoch) throw new Error('Session changed during recording playback');
    const { data: { session } } = await getMobileSupabaseClient().auth.getSession();
    if (requestEpoch !== audioEpoch || session?.user?.id !== userId) {
      throw new Error('Session changed during recording playback');
    }
  };

  // Lemtel gateway (lemtel-pbx · recording_audio): the server checks the CDR belongs to this organization and,
  // for a member, to their own extension; the device sends only the CDR id — never a path, name or domain.
  const doFetch = (tok: string) => lemtelPbxFetch(tok, { action: 'recording_audio', cdrId: xml_cdr_uuid });
  let res: Response;
  try {
    res = await doFetch(freshToken);
  } catch (e) {
    if (e instanceof LemtelPbxError && e.status === 401) {
      const sb = getMobileSupabaseClient();
      const { data: refreshed } = await sb.auth.refreshSession();
      if (!refreshed?.session?.access_token || refreshed.session.user.id !== userId || requestEpoch !== audioEpoch) {
        throw new Error('Session expirée. Déconnectez-vous et reconnectez-vous pour écouter les enregistrements.');
      }
      freshToken = refreshed.session.access_token;
      res = await doFetch(freshToken);
    } else if (e instanceof LemtelPbxError && e.status === 403) {
      throw new Error('Accès refusé à cet enregistrement.');
    } else if (e instanceof LemtelPbxError && e.status === 404) {
      throw new Error('Enregistrement indisponible (supprimé ou hors période de rétention).');
    } else if (e instanceof LemtelPbxError && e.code === 'organization_not_selected') {
      throw new Error('Organisation non chargée. Réessayez dans un instant.');
    } else {
      throw new Error('Enregistrement non disponible pour le moment.');
    }
  }
  if (!(res.headers.get('content-type') || '').startsWith('audio/')) throw new Error('Enregistrement non disponible pour le moment.');

  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty recording');
  await assertCurrentSession();
  const url = URL.createObjectURL(blob);
  return url;
}
