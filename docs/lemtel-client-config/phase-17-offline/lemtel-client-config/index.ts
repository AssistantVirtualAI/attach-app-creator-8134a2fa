// OFFLINE SOURCE (not deployed). Lemtel Phase 17: configuration manifest and device lifecycle (source-only, not connected to any client).
// Returns only the safe Phase 16 manifest. Never returns credentials, endpoints, extension numbers,
// forwarding targets, call data or audio. Credential delivery stays in the existing separate function.
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const ACTIONS = ["register", "manifest", "revoke_self", "revoke_device"] as const;
export type Action = typeof ACTIONS[number];
export type Platform = "mobile" | "desktop";
const FIELDS: Record<Action, string[]> = {
  register: ["action", "platform", "installationRef"],
  manifest: ["action", "platform", "deviceRef"],
  revoke_self: ["action", "platform", "deviceRef"],
  revoke_device: ["action", "deviceRef"],
};
const INSTALLATION_RE = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_REF_RE = /^dev_[0-9a-f]{32}$/;
export const MANIFEST_TTL_SECONDS = 15 * 60;
const OWN = "own_extension_only";
const REVOKE_BEHAVIOR = "stop_" + "sip_and_clear_local_session";

export type Failure = { error: string; status: number };
export type Request17 =
  | { action: "register"; platform: Platform; installationRef: string }
  | { action: "manifest" | "revoke_self"; platform: Platform; deviceRef: string }
  | { action: "revoke_device"; deviceRef: string };

export const fail = (error: string, status: number): Failure => ({ error, status });
export const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Strict input validation; runs before any database query. Never echoes input.
export function validateBody(body: unknown): Request17 | Failure {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("invalid_body", 400);
  const b = body as Record<string, unknown>;
  if (typeof b.action !== "string") return fail("invalid_body", 400);
  if (!(ACTIONS as readonly string[]).includes(b.action)) return fail("invalid_action", 400);
  const action = b.action as Action;
  const keys = Object.keys(b);
  if (keys.some((k) => !FIELDS[action].includes(k)) || FIELDS[action].some((k) => !(k in b))) return fail("invalid_body", 400);
  if (action !== "revoke_device" && b.platform !== "mobile" && b.platform !== "desktop") return fail("invalid_platform", 400);
  if (action === "register") {
    if (typeof b.installationRef !== "string" || !INSTALLATION_RE.test(b.installationRef)) return fail("invalid_installation_ref", 400);
    return { action, platform: b.platform as Platform, installationRef: b.installationRef };
  }
  if (typeof b.deviceRef !== "string" || !DEVICE_REF_RE.test(b.deviceRef)) return fail("invalid_device_ref", 400);
  if (action === "revoke_device") return { action, deviceRef: b.deviceRef };
  return { action, platform: b.platform as Platform, deviceRef: b.deviceRef };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
// Deterministic opaque reference: prefix + 24 hex chars of a namespaced digest. Raw inputs are not recoverable.
export async function opaqueRef(prefix: string, ...parts: (string | number | null | undefined)[]): Promise<string> {
  return `${prefix}_${(await sha256Hex(["lemtel-ccfg-v1", prefix, ...parts.map((p) => String(p ?? ""))].join("|"))).slice(0, 24)}`;
}

export type Account = {
  id: string; organization_id: string; domain_uuid: string | null; extension_id: string | null; portal_user_id: string;
  app_access_enabled: boolean; mobile_access_enabled: boolean; desktop_access_enabled: boolean;
  account_status: string | null; dnd_enabled: boolean; forward_enabled: boolean; updated_at: string | null;
};
// Internal ownership IDs (id, organization_id, user_id, softphone_user_id) are never placed in a response, manifest, error or log.
export type Device = { device_ref: string; state: "approved" | "pending" | "revoked"; revision: number; platform: Platform; id?: string; organization_id?: string; user_id?: string; softphone_user_id?: string };

// Only these columns are ever selected from the existing softphone account table.
export const ACCOUNT_COLUMNS = "id,organization_id,domain_uuid,extension_id,portal_user_id,app_access_enabled,mobile_access_enabled,desktop_access_enabled,account_status,dnd_enabled,forward_enabled,updated_at";
export const DEVICE_COLUMNS = "id,device_ref,state,revision,platform,organization_id,user_id,softphone_user_id";

export function accessFailure(a: Account | null, platform?: Platform): Failure | null {
  if (!a) return fail("no_softphone_account", 404);
  if (!a.app_access_enabled) return fail("app_access_disabled", 403);
  if (platform === "mobile" && !a.mobile_access_enabled) return fail("platform_access_disabled", 403);
  if (platform === "desktop" && !a.desktop_access_enabled) return fail("platform_access_disabled", 403);
  return null;
}

// Storage payload for a new lifecycle record: the raw installation reference is never included.
export async function deviceInsertPayload(a: Account, platform: Platform, installationRef: string) {
  return { user_id: a.portal_user_id, organization_id: a.organization_id, softphone_user_id: a.id, platform, installation_ref_hash: await sha256Hex(installationRef), state: "approved", revision: 1 };
}

// Re-registration resolver: one logical record; revoked never becomes approved.
export function resolveRegistration(existing: Device | null): "insert" | "reuse" | "revoked" {
  if (!existing) return "insert";
  return existing.state === "revoked" ? "revoked" : "reuse";
}

export async function buildManifest(a: Account, d: Device, now: Date = new Date()) {
  if (d.state === "revoked") return null;
  const status = (a.account_status ?? "").toLowerCase();
  const accountState = !a.app_access_enabled ? "disabled" : status === "suspended" ? "suspended" : status === "disabled" ? "disabled" : "active";
  return {
    schemaVersion: "lemtel_client_config_manifest_v1",
    identity: {
      organizationRef: await opaqueRef("org", a.organization_id),
      domainRef: await opaqueRef("dom", a.organization_id, a.domain_uuid),
      extensionRef: await opaqueRef("ext", a.id, a.extension_id),
      userRef: await opaqueRef("usr", a.portal_user_id),
      privacyScope: OWN,
    },
    access: { mobileEnabled: a.mobile_access_enabled, desktopEnabled: a.desktop_access_enabled, accountState, signInMode: "portal_password" },
    revision: {
      manifestRevision: await opaqueRef("rev", a.id, a.updated_at, d.device_ref, d.revision, d.state),
      issuedAt: new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z"),
      expiresAt: new Date(Math.floor(now.getTime() / 1000) * 1000 + MANIFEST_TTL_SECONDS * 1000).toISOString().replace(".000Z", "Z"),
      refreshMode: "foreground_and_revision_check",
      revocationBehavior: REVOKE_BEHAVIOR,
    },
    device: { deviceRef: d.device_ref, deviceState: d.state, deviceRevision: await opaqueRef("devrev", d.device_ref, d.revision), deviceAction: d.state === "approved" ? "none" : "refresh_required" },
    telephonyPolicy: {
      credentialRevisionRef: await opaqueRef("credrev", a.id, a.updated_at),
      dndState: a.dnd_enabled ? "enabled" : "disabled",
      forwardingState: a.forward_enabled ? "enabled" : "disabled",
      recordingPolicy: "portal_managed",
      voicemailPolicy: "enabled",
      callsPrivacyScope: OWN, recordingsPrivacyScope: OWN, voicemailPrivacyScope: OWN, transcriptsPrivacyScope: OWN,
    },
    routing: { routingMode: "direct_current", routingAssignmentRef: "route_direct_current_v1", fallbackMode: "direct_current", edgeFeatureGate: false },
    capabilities: { maestroSyncState: "disabled", avaCallActionState: "disabled", avaSmsActionState: "disabled", microsoftSsoState: "not_ready" },
    observability: { diagnosticLevel: "error_only", redactionPolicyRef: "redact_lemtel_default_v1", supportBundleAllowed: false },
  };
}

// Optimistic concurrency: a mutation succeeds only when exactly one row was returned and no error occurred.
export function mutationApplied(data: unknown, error: unknown): boolean {
  return !error && typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string";
}

// deno-lint-ignore no-explicit-any
async function audit(admin: any, userId: string, orgId: string, action: string, meta: Record<string, unknown>) {
  try {
    await admin.from("audit_logs").insert({ action: `lemtel_client_config.${action}`, resource_type: "lemtel_client_config_device", user_id: userId, organization_id: orgId, metadata: meta });
  } catch (_e) { /* audit failure is never exposed */ }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await req.json(); } catch (_e) { return respond({ error: "invalid_json" }, 400); }
  const v = validateBody(raw);
  if ("error" in v) return respond({ error: v.error }, v.status);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const userId = userData?.user?.id;
  if (userErr || !userId) return respond({ error: "unauthorized" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  try {
    if (v.action === "revoke_device") {
      const { data: target } = await admin.from("lemtel_client_config_devices").select(DEVICE_COLUMNS).eq("device_ref", v.deviceRef).maybeSingle();
      if (!target) return respond({ error: "forbidden" }, 403);
      const { data: lemtelAdmin } = await admin.rpc("is_lemtel_admin", { _user_id: userId });
      let allowed = lemtelAdmin === true;
      if (!allowed) {
        const { data: m } = await admin.from("org_members").select("role").eq("user_id", userId).eq("org_id", target.organization_id).maybeSingle();
        allowed = !!m && ["owner", "admin", "org_admin"].includes(String(m.role));
      }
      if (!allowed) return respond({ error: "forbidden" }, 403);
      if (target.state !== "revoked") {
        const { data: changed, error } = await admin.from("lemtel_client_config_devices").update({ state: "revoked", revision: target.revision + 1, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", target.id).eq("organization_id", target.organization_id).eq("revision", target.revision).eq("state", target.state).select("id").maybeSingle();
        if (!mutationApplied(changed, error)) return respond({ error: "forbidden" }, 409);
        await audit(admin, userId, target.organization_id, "revoke_device", { action: "revoke_device", platform: target.platform, state: "revoked", revision: target.revision + 1 });
      }
      return respond({ revoked: true, deviceAction: "revoke_required" });
    }

    const { data: acct } = await admin.from("pbx_softphone_users").select(ACCOUNT_COLUMNS).eq("portal_user_id", userId).limit(2);
    const account = acct && acct.length === 1 ? (acct[0] as Account) : null;
    const denied = accessFailure(account, v.platform);
    if (denied) return respond({ error: denied.error }, denied.status);
    const a = account as Account;

    if (v.action === "register") {
      const hash = await sha256Hex(v.installationRef);
      const { data: existing } = await admin.from("lemtel_client_config_devices").select(DEVICE_COLUMNS).eq("user_id", userId).eq("platform", v.platform).eq("installation_ref_hash", hash).eq("organization_id", a.organization_id).eq("softphone_user_id", a.id).maybeSingle();
      const decision = resolveRegistration(existing as Device | null);
      if (decision === "revoked") return respond({ error: "device_revoked" }, 403);
      let device = existing as Device | null;
      if (decision === "insert") {
        const { data: created, error } = await admin.from("lemtel_client_config_devices").insert(await deviceInsertPayload(a, v.platform, v.installationRef)).select(DEVICE_COLUMNS).single();
        if (error || !created) return respond({ error: "device_not_found" }, 409);
        device = created as Device;
        await audit(admin, userId, a.organization_id, "register", { action: "register", platform: v.platform, state: device.state, revision: device.revision });
      } else {
        const { data: seen, error: seenErr } = await admin.from("lemtel_client_config_devices").update({ last_seen_at: new Date().toISOString() })
          .eq("device_ref", (device as Device).device_ref).eq("user_id", userId).eq("organization_id", a.organization_id).eq("softphone_user_id", a.id).neq("state", "revoked").select("id").maybeSingle();
        if (!mutationApplied(seen, seenErr)) return respond({ error: "device_not_found" }, 409);
      }
      return respond(await buildManifest(a, device as Device));
    }

    const { data: own } = await admin.from("lemtel_client_config_devices").select(DEVICE_COLUMNS).eq("device_ref", v.deviceRef).eq("user_id", userId).eq("platform", v.platform).eq("organization_id", a.organization_id).eq("softphone_user_id", a.id).maybeSingle();
    if (!own) return respond({ error: "device_not_found" }, 404);
    const d = own as Device & { id: string; organization_id: string };
    if (d.state === "revoked") return respond({ error: "device_revoked" }, 403);

    if (v.action === "manifest") {
      const { data: seen, error: seenErr } = await admin.from("lemtel_client_config_devices").update({ last_seen_at: new Date().toISOString() })
        .eq("id", d.id).eq("user_id", userId).eq("platform", v.platform).eq("organization_id", a.organization_id).eq("softphone_user_id", a.id).neq("state", "revoked").select("id").maybeSingle();
      if (!mutationApplied(seen, seenErr)) return respond({ error: "device_not_found" }, 409);
      const m = await buildManifest(a, d);
      return m ? respond(m) : respond({ error: "device_revoked" }, 403);
    }

    const { data: changed, error } = await admin.from("lemtel_client_config_devices").update({ state: "revoked", revision: d.revision + 1, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", d.id).eq("user_id", userId).eq("organization_id", a.organization_id).eq("softphone_user_id", a.id).eq("revision", d.revision).eq("state", d.state).select("id").maybeSingle();
    if (!mutationApplied(changed, error)) return respond({ error: "device_not_found" }, 409);
    await audit(admin, userId, d.organization_id, "revoke_self", { action: "revoke_self", platform: v.platform, state: "revoked", revision: d.revision + 1 });
    return respond({ revoked: true, deviceAction: "revoke_required" });
  } catch (_e) {
    return respond({ error: "forbidden" }, 500);
  }
}

Deno.serve(handler);
