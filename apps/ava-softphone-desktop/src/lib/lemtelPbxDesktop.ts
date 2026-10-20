/**
 * Desktop client of the Lemtel telephony gateway (Edge Function `lemtel-pbx`).
 * Same contract as the mobile app: the server scopes every answer to the signed-in user's own
 * extension (member) or domain (admin); the app only names its organization, which the server
 * re-checks against the session. No PBX credential ever reaches the desktop.
 */
import { SB_KEY, SB_URL, supabase } from './supabaseClient';
import { LEGACY_BACKEND_URL } from './backendOrigin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LemtelPbxError extends Error { constructor(public readonly code: string, public readonly status: number) { super(code); } }

export type GatewayCdr = { id: string; direction: string | null; callerName: string | null; callerNumber: string | null; destination: string | null; startAt: string | null; billsec: number | null; duration: number | null; hangupCause: string | null; missed: boolean; hasRecording: boolean };
export type GatewayVoicemail = { uuid: string; createdAt: string | null; callerName: string; callerNumber: string; seconds: number; status: string; transcription: string | null };
export type GatewaySelf = { extension: string; callerIdName: string | null; forwarding: Record<string, string | null>; voicemail: { enabled: boolean; messages: GatewayVoicemail[] } | null; recentCalls: GatewayCdr[]; writesEnabled: boolean };

export function lemtelGatewayAvailable(organizationId: string | null | undefined): organizationId is string {
  return Boolean(organizationId && UUID_RE.test(organizationId) && SB_URL && SB_URL !== LEGACY_BACKEND_URL);
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new LemtelPbxError('unauthorized', 401);
  return value;
}

export async function lemtelPbxFetch(organizationId: string, body: Record<string, unknown>): Promise<Response> {
  if (!lemtelGatewayAvailable(organizationId)) throw new LemtelPbxError('organization_not_selected', 0);
  const bearer = await token();
  let res: Response;
  try {
    res = await fetch(`${SB_URL}/functions/v1/lemtel-pbx`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ organizationId, ...body }),
    });
  } catch { throw new LemtelPbxError('network', 0); }
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new LemtelPbxError(typeof j?.error === 'string' && /^[a-z0-9_]{2,80}$/.test(j.error) ? j.error : res.status === 404 ? 'function_not_deployed' : 'server_error', res.status);
  }
  return res;
}

async function json<T>(organizationId: string, body: Record<string, unknown>): Promise<T> {
  const j = await (await lemtelPbxFetch(organizationId, body)).json().catch(() => null) as (T & { error?: unknown }) | null;
  if (!j || j.error) throw new LemtelPbxError(typeof j?.error === 'string' ? j.error : 'server_error', 0);
  return j;
}

const isoDay = (d: Date) => d.toISOString();

export const desktopPbx = {
  me: (org: string) => json<GatewaySelf>(org, { action: 'self_overview' }),
  calls: (org: string, opts: { days?: number; missedOnly?: boolean; recordedOnly?: boolean; limit?: number } = {}) => {
    const to = new Date();
    const from = new Date(to.getTime() - (opts.days ?? 30) * 86_400_000);
    return json<{ records: GatewayCdr[]; total: number }>(org, { action: 'cdr_list', from: isoDay(from), to: isoDay(to), limit: opts.limit ?? 100,
      ...(opts.missedOnly ? { missedOnly: true } : {}), ...(opts.recordedOnly ? { recordedOnly: true } : {}) });
  },
  recording: async (org: string, cdrId: string) => (await lemtelPbxFetch(org, { action: 'recording_audio', cdrId })).blob(),
  voicemailAudio: async (org: string, messageUuid: string) => (await lemtelPbxFetch(org, { action: 'voicemail_audio', messageUuid })).blob(),
};
export const desktopPbxWrites = {
  deleteVoicemail: (org: string, messageUuid: string) => json<{ ok: true }>(org, { action: 'self_voicemail_delete', messageUuid }),
};
