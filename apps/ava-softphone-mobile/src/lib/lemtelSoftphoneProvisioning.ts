// Lemtel softphone provisioning — SHARED CONTRACT. This file is byte-identical in
// apps/ava-softphone-desktop and apps/ava-softphone-mobile (enforced by
// scripts/lemtel-softphone-provisioning-contract.test.mjs) so both apps use exactly the same
// connection. The portal (Connexion FusionPBX) is the only authority: no SIP domain, WSS URL,
// TURN server or password is hardcoded in a client. Pure module: no React, no storage.

export const LEMTEL_PROVISIONING_SCHEMA = 'lemtel_softphone_provisioning_v1';
export const LEMTEL_PROVISIONING_FUNCTION = 'lemtel-softphone-provisioning';

export type LemtelProvisioningStatus =
  | 'ready' | 'not_assigned' | 'not_provisioned' | 'pending_activation' | 'suspended' | 'delivery_disabled' | 'credential_missing';

export type LemtelIceServer = { urls: string[]; username?: string; credential?: string };

export type LemtelTelephony = {
  sipDomain: string;
  extension: string;
  authorizationUser: string;
  displayName: string;
  wssUrls: string[];
  outboundProxy: string | null;
  registerExpires: number;
  codecs: string[];
  srtpMode: 'dtls_srtp' | 'sdes' | 'none';
};

export type LemtelProvisioning =
  | { status: 'ready'; connectionRevision: number; credentialRevision: number; expiresAt: string;
      telephony: LemtelTelephony & { password: string }; media: { iceServers: LemtelIceServer[]; iceTransportPolicy: 'all' | 'relay' } }
  | { status: Exclude<LemtelProvisioningStatus, 'ready'>; telephony?: LemtelTelephony; connectionRevision?: number };

/** Settings consumed by the JsSIP (Desktop, Android) and native (iOS) SIP stacks — same values everywhere. */
export type LemtelSipSettings = {
  extension: string; displayName: string; sipDomain: string; wssUrl: string; wssUrls: string[];
  password: string; authUsername: string; registerExpires: number; iceServers: LemtelIceServer[];
  iceTransportPolicy: 'all' | 'relay'; outboundProxy: string | null; codecs: string[]; expiresAt: string;
};

export class LemtelProvisioningError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

const STATUSES: readonly string[] = ['ready', 'not_assigned', 'not_provisioned', 'pending_activation', 'suspended', 'delivery_disabled', 'credential_missing'];
const HOST = /^[a-z0-9.-]{3,253}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, re?: RegExp) => (typeof v === 'string' && v.length > 0 && v.length <= 300 && (!re || re.test(v)) ? v : null);

function wssList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 4) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    let u: URL;
    try { u = new URL(item); } catch { return null; }
    if (u.protocol !== 'wss:' || u.username || u.password || !HOST.test(u.hostname)) return null;
    out.push(item);
  }
  return out;
}

function telephony(v: unknown): LemtelTelephony | null {
  if (!isObj(v)) return null;
  const sipDomain = str(v.sipDomain, HOST);
  const extension = str(v.extension, /^[0-9]{2,8}$/);
  const authorizationUser = str(v.authorizationUser, /^[A-Za-z0-9._@+-]{1,64}$/);
  const displayName = str(v.displayName);
  const wssUrls = wssList(v.wssUrls);
  const registerExpires = typeof v.registerExpires === 'number' && v.registerExpires >= 60 && v.registerExpires <= 3600 ? v.registerExpires : null;
  const codecs = Array.isArray(v.codecs) && v.codecs.every((c) => typeof c === 'string') ? (v.codecs as string[]) : null;
  const srtpMode = v.srtpMode === 'dtls_srtp' || v.srtpMode === 'sdes' || v.srtpMode === 'none' ? v.srtpMode : null;
  const outboundProxy = v.outboundProxy === null || v.outboundProxy === undefined ? null : str(v.outboundProxy, /^[a-z0-9.-]+:\d{1,5}$/);
  if (!sipDomain || !extension || !authorizationUser || !displayName || !wssUrls || !registerExpires || !codecs || !srtpMode
    || (v.outboundProxy && !outboundProxy)) return null;
  return { sipDomain, extension, authorizationUser, displayName, wssUrls, outboundProxy, registerExpires, codecs, srtpMode };
}

function iceServers(v: unknown): LemtelIceServer[] | null {
  if (!Array.isArray(v) || v.length > 4) return null;
  const out: LemtelIceServer[] = [];
  for (const s of v) {
    if (!isObj(s) || !Array.isArray(s.urls) || !s.urls.every((u) => typeof u === 'string' && /^(stuns?|turns?):/.test(u))) return null;
    const entry: LemtelIceServer = { urls: s.urls as string[] };
    if (s.username !== undefined || s.credential !== undefined) {
      if (typeof s.username !== 'string' || typeof s.credential !== 'string') return null;
      entry.username = s.username; entry.credential = s.credential;
    }
    out.push(entry);
  }
  return out;
}

/** Strict parse of the server answer. Anything unexpected is refused (fail closed). */
export function parseLemtelProvisioning(raw: unknown): LemtelProvisioning | null {
  if (!isObj(raw) || raw.schema !== LEMTEL_PROVISIONING_SCHEMA || typeof raw.status !== 'string' || !STATUSES.includes(raw.status)) return null;
  if (raw.status !== 'ready') {
    const t = raw.telephony === undefined ? undefined : telephony(raw.telephony);
    if (t === null) return null;
    return { status: raw.status as Exclude<LemtelProvisioningStatus, 'ready'>, ...(t ? { telephony: t } : {}),
      ...(typeof raw.connectionRevision === 'number' ? { connectionRevision: raw.connectionRevision } : {}) };
  }
  const t = telephony(raw.telephony);
  const password = isObj(raw.telephony) ? str(raw.telephony.password) : null;
  const media = isObj(raw.media) ? raw.media : null;
  const ice = media ? iceServers(media.iceServers) : null;
  const policy = media?.iceTransportPolicy === 'relay' ? 'relay' : media?.iceTransportPolicy === 'all' ? 'all' : null;
  const expiresAt = str(raw.expiresAt);
  if (!t || !password || !ice || !policy || !expiresAt || !Number.isFinite(Date.parse(expiresAt))
    || typeof raw.connectionRevision !== 'number' || typeof raw.credentialRevision !== 'number') return null;
  return { status: 'ready', connectionRevision: raw.connectionRevision, credentialRevision: raw.credentialRevision, expiresAt,
    telephony: { ...t, password }, media: { iceServers: ice, iceTransportPolicy: policy } };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One GET, scoped by the server to the signed-in user's own extension. Never cached by the browser. */
export async function fetchLemtelProvisioning(backendUrl: string, publishableKey: string, accessToken: string,
  client: 'mobile' | 'desktop', fetcher: FetchLike = fetch): Promise<LemtelProvisioning> {
  let response: Response;
  try {
    response = await fetcher(`${backendUrl}/functions/v1/${LEMTEL_PROVISIONING_FUNCTION}`, {
      method: 'GET', cache: 'no-store',
      headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'X-Lemtel-Client': client },
    });
  } catch { throw new LemtelProvisioningError('provisioning_network_error', 0); }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === 'string' && /^[a-z0-9_]{2,80}$/.test(body.error) ? body.error
      : response.status === 404 ? 'provisioning_not_deployed' : 'provisioning_failed';
    throw new LemtelProvisioningError(code, response.status);
  }
  const parsed = parseLemtelProvisioning(body);
  if (!parsed) throw new LemtelProvisioningError('provisioning_invalid_response', response.status);
  return parsed;
}

/** Maps a ready provisioning to the SIP stack settings. Same function for Desktop and Mobile. */
export function toLemtelSipSettings(p: Extract<LemtelProvisioning, { status: 'ready' }>): LemtelSipSettings {
  const t = p.telephony;
  return { extension: t.extension, displayName: t.displayName, sipDomain: t.sipDomain, wssUrl: t.wssUrls[0], wssUrls: t.wssUrls,
    password: t.password, authUsername: t.authorizationUser, registerExpires: t.registerExpires, iceServers: p.media.iceServers,
    iceTransportPolicy: p.media.iceTransportPolicy, outboundProxy: t.outboundProxy, codecs: t.codecs, expiresAt: p.expiresAt };
}

const MESSAGES: Record<string, [string, string]> = {
  not_assigned: ['Aucune extension ne vous est attribuée dans le portail Lemtel.', 'No extension is assigned to you in the Lemtel portal.'],
  not_provisioned: ['La connexion téléphonique de votre organisation n’est pas encore configurée.', 'Your organization’s phone connection is not configured yet.'],
  pending_activation: ['La connexion téléphonique est en cours de validation par votre administrateur.', 'The phone connection is being validated by your administrator.'],
  suspended: ['La connexion téléphonique de votre organisation est suspendue.', 'Your organization’s phone connection is suspended.'],
  delivery_disabled: ['La téléphonie n’est pas encore ouverte aux applications (activation plateforme en attente).', 'Telephony is not open to the apps yet (platform activation pending).'],
  credential_missing: ['Votre mot de passe SIP n’a pas été saisi dans le portail. Contactez votre administrateur.', 'Your SIP password has not been entered in the portal. Contact your administrator.'],
  lemtel_active_client_access_required: ['L’accès de cette application est désactivé pour votre compte.', 'This app’s access is disabled for your account.'],
  provisioning_not_deployed: ['Le service de provisionnement Lemtel n’est pas encore déployé.', 'The Lemtel provisioning service is not deployed yet.'],
  provisioning_network_error: ['Réseau indisponible : réessayez.', 'Network unavailable: try again.'],
};
export function lemtelProvisioningMessage(code: string, lang: 'fr' | 'en' = 'fr'): string {
  const m = MESSAGES[code];
  return m ? m[lang === 'fr' ? 0 : 1] : (lang === 'fr' ? `Téléphonie indisponible (${code}).` : `Telephony unavailable (${code}).`);
}

/** Refresh shortly before the server-declared expiry (credentials can rotate in the portal). */
export function lemtelProvisioningRefreshDelayMs(expiresAt: string, now = Date.now()): number {
  const t = Date.parse(expiresAt) - now - 60_000;
  return Math.max(30_000, Number.isFinite(t) ? t : 30_000);
}
