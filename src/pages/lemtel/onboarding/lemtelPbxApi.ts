// Portal client for the Lemtel FusionPBX connection (Edge Function lemtel-pbx-connection-admin).
// Secrets are sent once (write-only) and never come back: the server returns only "set / set at".
// Namespace import: constants are read at call time (keeps partial test mocks of the module working).
import * as hosted from "./lemtelHostedApi";

export type PbxSettings = {
  sipDomain: string; pbxHost: string; sipTransport: "udp" | "tcp" | "tls"; sipPort: number; wssUrl: string; outboundProxy: string | null;
  stunUrls: string[]; turnUrls: string[]; registrationExpires: number; codecs: string[]; srtpMode: "dtls_srtp" | "sdes" | "none";
  managementMode: "none" | "fusionpbx_api"; managementBaseUrl: string | null;
};
export type PbxCheck = { key: string; status: "ok" | "failed" | "skipped"; detail: string };
export type PbxReport = { checkedAt: string; checks: PbxCheck[]; passed: boolean };
export type PbxConnection = PbxSettings & { vendor: "fusionpbx"; state: "draft" | "validated" | "active" | "suspended"; revision: number; lastValidation: PbxReport | null };
export type PbxAssignment = { userId: string; email: string | null; userName: string | null; extension: string; authUsername: string | null; displayName: string | null; isTest: boolean; state: string; credentialSet: boolean; credentialSetAt: string | null; credentialRevision: number };
export type PbxMember = { userId: string; email: string; name: string; role: string };
export type PbxSecretKind = "turn_shared_secret" | "fusionpbx_api_key";
export type PbxState = {
  connection: PbxConnection | null;
  secrets: Record<PbxSecretKind, { set: boolean; setAt: string | null }>;
  assignments: PbxAssignment[];
  members: PbxMember[];
  activationBlocker: string | null;
  serverReadiness: { encryptionKeyConfigured: boolean; credentialDeliveryEnabled: boolean };
};

/** Server codes are fixed snake_case tokens (never free text), safe to map to a message. */
export class PbxApiError extends Error { constructor(public readonly code: string, public readonly status: number) { super(code); } }

const FUNCTION = "lemtel-pbx-connection-admin";
async function call<T>(organizationId: string, body: Record<string, unknown>, write: boolean): Promise<T> {
  let configured = false, writable = false;
  try { configured = hosted.LEMTEL_BACKEND_CONFIGURED; writable = hosted.LEMTEL_ONBOARDING_ENABLED; } catch { /* module mocked without config */ }
  if (!configured) throw new PbxApiError("backend_not_configured", 0);
  if (write && !writable) throw new PbxApiError("portal_readonly", 0);
  const { data } = await hosted.lemtelClient()!.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PbxApiError("unauthorized", 401);
  let response: Response;
  try {
    response = await fetch(`${hosted.LEMTEL_API_URL}/functions/v1/${FUNCTION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: hosted.LEMTEL_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ organizationId, ...body }),
    });
  } catch { throw new PbxApiError("network", 0); }
  const json = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok || json?.error) {
    const code = typeof json?.error === "string" && /^[a-z0-9_]{2,80}$/.test(json.error) ? json.error : response.status === 404 ? "function_not_deployed" : "server_error";
    throw new PbxApiError(code, response.status);
  }
  return json as T;
}

export const pbxApi = {
  get: (org: string) => call<PbxState>(org, { action: "get_connection" }, false),
  saveSettings: (org: string, settings: Partial<PbxSettings>) => call<PbxState>(org, { action: "save_settings", settings }, true),
  setSecret: (org: string, kind: PbxSecretKind, value: string) => call<{ ok: true }>(org, { action: "set_secret", kind, value }, true),
  clearSecret: (org: string, kind: PbxSecretKind) => call<{ ok: true }>(org, { action: "clear_secret", kind }, true),
  assign: (org: string, assignment: { userId: string; extension: string; authUsername?: string | null; displayName?: string | null; isTest: boolean }, sipPassword: string | null) =>
    call<PbxState>(org, { action: "assign_extension", assignment, sipPassword }, true),
  unassign: (org: string, userId: string) => call<PbxState>(org, { action: "unassign_extension", userId }, true),
  validate: (org: string) => call<PbxState & { report: PbxReport }>(org, { action: "validate" }, true),
  setState: (org: string, state: "active" | "suspended" | "draft") => call<PbxState>(org, { action: "set_state", state }, true),
};

/** Turns the form text fields into the strict server payload (lists split on commas/spaces/newlines). */
export function settingsFromForm(f: Record<string, string>): Partial<PbxSettings> {
  const listOf = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const out: Partial<PbxSettings> = {
    sipDomain: f.sipDomain.trim().toLowerCase(), pbxHost: f.pbxHost.trim().toLowerCase(), sipTransport: f.sipTransport as PbxSettings["sipTransport"],
    sipPort: Number(f.sipPort), wssUrl: f.wssUrl.trim(), outboundProxy: f.outboundProxy.trim() || null, stunUrls: listOf(f.stunUrls), turnUrls: listOf(f.turnUrls),
    registrationExpires: Number(f.registrationExpires), codecs: listOf(f.codecs), srtpMode: f.srtpMode as PbxSettings["srtpMode"],
    managementMode: f.managementMode as PbxSettings["managementMode"],
  };
  if (out.managementMode === "fusionpbx_api") out.managementBaseUrl = f.managementBaseUrl.trim();
  return out;
}

/** Suggests the WSS URL FusionPBX exposes by default (internal profile wss-binding :7443). */
export function suggestedWssUrl(pbxHost: string): string {
  const h = pbxHost.trim().toLowerCase();
  return h ? `wss://${h}:7443` : "";
}
