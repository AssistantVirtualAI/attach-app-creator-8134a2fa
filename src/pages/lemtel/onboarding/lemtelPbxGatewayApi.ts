// Portal client for the Lemtel telephony gateway (Edge Function lemtel-pbx). The server decides every permission
// (platform / domain admin / member) and confines each request to the organization's FusionPBX domain.
import * as hosted from "./lemtelHostedApi";

export class PbxGatewayError extends Error { constructor(public readonly code: string, public readonly status: number) { super(code); } }

export type FieldSpec = { t: "str"; max: number } | { t: "int"; min: number; max: number } | { t: "bool" } | { t: "enum"; values: string[] } | { t: "uuid" } | { t: "secret" };
export type CatalogEntry = { key: string; scope: "domain" | "global"; label: string; uuid: string; ops: Array<"list" | "get" | "create" | "update" | "delete">; read: string[];
  parent: { field: string; resource: string } | null; required: string[]; write: Record<string, FieldSpec> };
export type Capabilities = { role: "platform" | "owner" | "admin" | "member"; configured: boolean; managementMode: string; managementReady: boolean; verifiedAt: string | null;
  domainName: string | null; writesEnabled: boolean; connectionState: string | null; selfExtension: string | null; cdrSync: { last_run_at: string | null; last_outcome: string | null } | null; catalog: CatalogEntry[] };
export type Item = Record<string, string | number | boolean | null>;
export type CdrRecord = { id: string; direction: string | null; callerName: string | null; callerNumber: string | null; destination: string | null; startAt: string | null; answerAt: string | null;
  endAt: string | null; duration: number | null; billsec: number | null; hangupCause: string | null; missed: boolean; hasRecording: boolean };
export type CdrFilter = { from: string; to: string; direction?: string; search?: string; missedOnly?: boolean; recordedOnly?: boolean; limit?: number; offset?: number };
export type CdrStats = { total: number; answered: number; missed: number; inbound: number; outbound: number; local: number; talkSeconds: number; averageTalkSeconds: number; recorded: number;
  byDay: Array<{ day: string; total: number; answered: number; missed: number }>; byHour: Array<{ hour: number; total: number }>; byCause: Array<{ cause: string; total: number }>;
  topNumbers: Array<{ number: string; total: number; talkSeconds: number }> };
export type LiveCall = { uuid: string; direction: string; createdAt: string | null; callerName: string; callerNumber: string; destination: string; state: string; application: string; presence: string; secure: boolean };
export type Registration = { user: string; agent: string; expiresAt: string | null; networkIp: string; status: string };
export type VoicemailMessage = { uuid: string; createdAt: string | null; callerName: string; callerNumber: string; seconds: number; status: string; transcription: string | null };
export type SelfOverview = { extension: string; callerIdName: string | null; forwarding: Record<string, string | null>; voicemail: { enabled: boolean; messages: VoicemailMessage[] } | null; recentCalls: CdrRecord[]; writesEnabled: boolean };

const FUNCTION = "lemtel-pbx";
async function raw(organizationId: string, body: Record<string, unknown>, write: boolean): Promise<Response> {
  let configured = false, writable = false;
  try { configured = hosted.LEMTEL_BACKEND_CONFIGURED; writable = hosted.LEMTEL_ONBOARDING_ENABLED; } catch { /* mocked */ }
  if (!configured) throw new PbxGatewayError("backend_not_configured", 0);
  if (write && !writable) throw new PbxGatewayError("portal_readonly", 0);
  const { data } = await hosted.lemtelClient()!.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PbxGatewayError("unauthorized", 401);
  let response: Response;
  try {
    response = await fetch(`${hosted.LEMTEL_API_URL}/functions/v1/${FUNCTION}`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: hosted.LEMTEL_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ organizationId, ...body }),
    });
  } catch { throw new PbxGatewayError("network", 0); }
  if (!response.ok) {
    const json = await response.json().catch(() => null) as { error?: unknown } | null;
    const code = typeof json?.error === "string" && /^[a-z0-9_]{2,80}$/.test(json.error) ? json.error : response.status === 404 ? "function_not_deployed" : "server_error";
    throw new PbxGatewayError(code, response.status);
  }
  return response;
}
async function call<T>(organizationId: string, body: Record<string, unknown>, write = false): Promise<T> {
  const response = await raw(organizationId, body, write);
  const json = await response.json().catch(() => null) as (T & { error?: unknown }) | null;
  if (!json || json.error) throw new PbxGatewayError(typeof json?.error === "string" ? json.error : "server_error", response.status);
  return json;
}

export const pbxGateway = {
  capabilities: (org: string) => call<Capabilities>(org, { action: "capabilities" }),
  testManagement: (org: string) => call<{ ok: true; domainName: string; writesEnabled: boolean }>(org, { action: "test_management" }, true),
  setWrites: (org: string, enabled: boolean) => call<{ ok: true; writesEnabled: boolean }>(org, { action: "set_management_writes", enabled, ...(enabled ? { confirm: "PBX_OWNERS_AGREED" } : {}) }, true),
  list: (org: string, resource: string, opts: { parentUuid?: string; search?: string; limit?: number; offset?: number } = {}) => call<{ items: Item[] }>(org, { action: "resource_list", resource, ...opts }),
  get: (org: string, resource: string, uuid: string) => call<{ item: Item }>(org, { action: "resource_get", resource, uuid }),
  create: (org: string, resource: string, values: Record<string, unknown>, assignUserId?: string) => call<{ ok: true; uuid: string | null; boundUserId: string | null }>(org, { action: "resource_create", resource, values, ...(assignUserId ? { assignUserId } : {}) }, true),
  update: (org: string, resource: string, uuid: string, values: Record<string, unknown>, assignUserId?: string) => call<{ ok: true; boundUserId: string | null }>(org, { action: "resource_update", resource, uuid, values, ...(assignUserId ? { assignUserId } : {}) }, true),
  remove: (org: string, resource: string, uuid: string) => call<{ ok: true }>(org, { action: "resource_delete", resource, uuid, confirm: "DELETE" }, true),
  voicemailMessages: (org: string, voicemailUuid: string) => call<{ messages: VoicemailMessage[] }>(org, { action: "voicemail_messages", voicemailUuid }),
  deleteVoicemailMessage: (org: string, voicemailUuid: string, messageUuid: string) => call<{ ok: true }>(org, { action: "voicemail_message_delete", voicemailUuid, messageUuid }, true),
  resetVoicemail: (org: string, voicemailUuid: string, purge: boolean) => call<{ ok: true; pin: string; purged: number }>(org, { action: "voicemail_reset", voicemailUuid, purge }, true),
  syncCdr: (org: string) => call<{ ok: true; rowsSeen: number; pages: number; completePass: boolean }>(org, { action: "cdr_sync" }, true),
  cdr: (org: string, f: CdrFilter) => call<{ records: CdrRecord[]; total: number }>(org, { action: "cdr_list", ...f }),
  cdrStats: (org: string, f: CdrFilter) => call<{ stats: CdrStats; from: string; to: string }>(org, { action: "cdr_stats", from: f.from, to: f.to }),
  cdrCsv: async (org: string, f: CdrFilter) => (await raw(org, { action: "cdr_export", ...f, limit: 10000 }, false)).blob(),
  recording: async (org: string, cdrId: string) => (await raw(org, { action: "recording_audio", cdrId }, false)).blob(),
  liveCalls: (org: string) => call<{ calls: LiveCall[] }>(org, { action: "live_calls" }),
  registrations: (org: string) => call<{ registrations: Registration[] }>(org, { action: "registrations" }),
  hangup: (org: string, uuid: string) => call<{ ok: true }>(org, { action: "call_hangup", uuid }, true),
  transfer: (org: string, uuid: string, destination: string) => call<{ ok: true }>(org, { action: "call_transfer", uuid, destination }, true),
  eavesdrop: (org: string, uuid: string, mode: "listen" | "whisper" | "barge") => call<{ ok: true; ringing: string }>(org, { action: "call_eavesdrop", uuid, mode }, true),
  gatewaysStatus: (org: string) => call<{ status: Record<string, string> }>(org, { action: "gateways_status" }),
  gatewayControl: (org: string, uuid: string, op: "start" | "stop") => call<{ ok: true }>(org, { action: "gateway_control", uuid, op }, true),
  me: (org: string) => call<SelfOverview>(org, { action: "self_overview" }),
  updateForwarding: (org: string, values: Record<string, unknown>) => call<{ ok: true }>(org, { action: "self_update_forwarding", values }, true),
  setMyVoicemailPin: (org: string, pin: string) => call<{ ok: true }>(org, { action: "self_voicemail_pin", pin }, true),
  deleteMyVoicemail: (org: string, messageUuid: string) => call<{ ok: true }>(org, { action: "self_voicemail_delete", messageUuid }, true),
  clickToCall: (org: string, destination: string) => call<{ ok: true; ringing: string }>(org, { action: "self_click_to_call", destination }, true),
};
