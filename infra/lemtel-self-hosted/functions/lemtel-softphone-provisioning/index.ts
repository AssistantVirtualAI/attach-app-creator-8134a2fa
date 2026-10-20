// Lemtel softphone provisioning — the ONE place Mobile and Desktop get their telephony connection.
// Same contract for both clients: identical SIP/WSS/ICE descriptor, scoped by the server to the caller's own
// extension. Delivery requires (1) an active Lemtel membership with client access, (2) an ACTIVE organization
// connection (validated by the portal), (3) an extension assignment with a credential, and (4) the platform gate
// LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY=enabled. Otherwise it returns a precise non-secret status.
// TURN is always a short-lived HMAC credential; the TURN shared secret never leaves the server.
import { createClient } from "npm:@supabase/supabase-js@2";
import { clientTelephony, extensionAad, loadSecretKey, openSecret, platformIce, rowFromDb, secretAad, turnCredential } from "../_shared/lemtelPbxConnection.ts";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private", Pragma: "no-cache" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
export const PROVISIONING_SCHEMA = "lemtel_softphone_provisioning_v1";
export const CREDENTIAL_TTL_SECONDS = 900;
const TURN_TTL_SECONDS = 3600;

// deno-lint-ignore no-explicit-any
export type Deps = { admin: any; env: (n: string) => string | undefined; now: () => number };

const status = (state: string, extra: Record<string, unknown> = {}) => respond({ schema: PROVISIONING_SCHEMA, status: state, ...extra });

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "GET") return respond({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return respond({ error: "unauthorized" }, 401);
  const { admin, env } = d;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return respond({ error: "unauthorized" }, 401);
  if (user.app_metadata?.lemtel_onboarding_required === true) return respond({ error: "first_password_change_required" }, 409);
  const client = (req.headers.get("X-Lemtel-Client") ?? "").toLowerCase();
  if (client !== "mobile" && client !== "desktop") return respond({ error: "client_kind_required" }, 400);
  // Same server authority as lemtel-session-bootstrap: active membership AND this client family not revoked.
  const { data: context, error: contextError } = await admin.rpc("lemtel_session_bootstrap_context_for_client", { p_user_id: user.id, p_client_kind: client });
  if (contextError || !context?.length) return respond({ error: "lemtel_active_client_access_required" }, 403);
  const organizationIds = (context as Array<Record<string, unknown>>).map((c) => String(c.organization_id));

  const { data: assignment } = await admin.from("lemtel_pbx_extension_assignments")
    .select("organization_id,user_id,extension,auth_username,display_name,sip_password_ciphertext,credential_revision,state")
    .eq("user_id", user.id).in("organization_id", organizationIds).eq("state", "assigned").limit(1).maybeSingle();
  if (!assignment) return status("not_assigned");
  const { data: conn } = await admin.from("lemtel_pbx_connections").select("*").eq("organization_id", assignment.organization_id).maybeSingle();
  const row = rowFromDb(conn ?? null);
  if (!row) return status("not_provisioned");
  if (row.state !== "active") return status(row.state === "suspended" ? "suspended" : "pending_activation");
  const descriptor = clientTelephony(row, assignment, String(user.user_metadata?.full_name || user.email || assignment.extension));
  if (env("LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY") !== "enabled") return status("delivery_disabled", { telephony: descriptor, connectionRevision: row.revision });
  if (!assignment.sip_password_ciphertext) return status("credential_missing", { telephony: descriptor, connectionRevision: row.revision });
  const key = await loadSecretKey(env);
  if (!key) return respond({ error: "server_not_configured" }, 503);
  const password = await openSecret(key, assignment.sip_password_ciphertext, extensionAad(String(assignment.organization_id), user.id, assignment.extension));
  if (!password) return status("credential_missing", { telephony: descriptor, connectionRevision: row.revision });

  // ICE: the organization's own STUN/TURN when configured, otherwise the Lemtel-hosted relay (decision D2).
  const platform = platformIce(env);
  const iceServers: Array<Record<string, unknown>> = [];
  const stunUrls = row.stunUrls.length ? row.stunUrls : platform.stunUrls;
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  let turn: { urls: string[]; secret: string } | null = null;
  if (row.turnUrls.length) {
    const { data: secret } = await admin.from("lemtel_pbx_connection_secrets").select("ciphertext").eq("organization_id", assignment.organization_id).eq("secret_kind", "turn_shared_secret").maybeSingle();
    const shared = secret?.ciphertext ? await openSecret(key, secret.ciphertext, secretAad(String(assignment.organization_id), "turn_shared_secret")) : null;
    if (shared) turn = { urls: row.turnUrls, secret: shared };
  }
  if (!turn && platform.turnUrls.length && platform.secret) turn = { urls: platform.turnUrls, secret: platform.secret };
  if (turn) {
    const t = await turnCredential(turn.secret, user.id.replace(/-/g, "").slice(0, 16), TURN_TTL_SECONDS, d.now());
    iceServers.push({ urls: turn.urls, username: t.username, credential: t.credential });
  }
  try {
    await admin.from("lemtel_pbx_connection_audit").insert({ organization_id: assignment.organization_id, actor_id: user.id, action: "credential_delivered",
      subject_user_id: user.id, metadata: { client, credentialRevision: assignment.credential_revision } });
  } catch { /* audit is best-effort; never blocks a valid client */ }
  return status("ready", {
    connectionRevision: row.revision,
    credentialRevision: assignment.credential_revision,
    expiresAt: new Date(d.now() + CREDENTIAL_TTL_SECONDS * 1000).toISOString(),
    telephony: { ...descriptor, password },
    media: { iceServers, iceTransportPolicy: "all" },
  });
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return handle(req, { admin, env: (n) => Deno.env.get(n), now: Date.now });
  });
}
