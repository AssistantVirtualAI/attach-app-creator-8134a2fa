/**
 * Mobile client of the Lemtel telephony gateway (Edge Function `lemtel-pbx`, phases 8.1–8.7).
 * The server scopes every answer to the signed-in user's own extension (member) or domain (admin);
 * the app only names its organization, which the server re-checks against the session.
 */
import { BACKEND_ANON_KEY, BACKEND_URL } from './backendOrigin';

let organizationId: string | null = null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set from the verified session bootstrap (creds.organizationId); cleared at sign-out. */
export function setLemtelOrganizationId(id: string | null | undefined) { organizationId = id && UUID_RE.test(id) ? id : null; }
export function getLemtelOrganizationId() { return organizationId; }

export class LemtelPbxError extends Error { constructor(public readonly code: string, public readonly status: number) { super(code); } }

export async function lemtelPbxFetch(token: string, body: Record<string, unknown>): Promise<Response> {
  if (!organizationId) throw new LemtelPbxError('organization_not_selected', 0);
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/functions/v1/lemtel-pbx`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: BACKEND_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ organizationId, ...body }),
    });
  } catch { throw new LemtelPbxError('network', 0); }
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new LemtelPbxError(typeof j?.error === 'string' && /^[a-z0-9_]{2,80}$/.test(j.error) ? j.error : res.status === 404 ? 'function_not_deployed' : 'server_error', res.status);
  }
  return res;
}

export async function lemtelPbxJson<T>(token: string, body: Record<string, unknown>): Promise<T> {
  return (await (await lemtelPbxFetch(token, body)).json()) as T;
}

export type GatewayCdr = { id: string; direction: string | null; callerName: string | null; callerNumber: string | null; destination: string | null; startAt: string | null; billsec: number | null; duration: number | null; hangupCause: string | null; missed: boolean; hasRecording: boolean };
export type GatewayVoicemail = { uuid: string; createdAt: string | null; callerName: string; callerNumber: string; seconds: number; status: string; transcription: string | null };
export type GatewaySelf = { extension: string; callerIdName: string | null; forwarding: Record<string, string | null>; voicemail: { enabled: boolean; messages: GatewayVoicemail[] } | null; recentCalls: GatewayCdr[]; writesEnabled: boolean };
