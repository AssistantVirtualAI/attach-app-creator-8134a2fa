// Lemtel — the app registers its push channel (iOS PushKit VoIP token / Android FCM token) so an incoming call can
// wake it. Signed-in Lemtel user only; the device is bound to that user in every organization they are an active
// member of. A token moved to another account is removed from the previous one (no call ever reaches the wrong person).
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEVICES_PER_USER = 10;

// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = { admin: Admin; now: () => number };
type Registration = { action: "register"; deviceId: string; platform: "ios" | "android"; channel: "apns_voip" | "fcm"; token: string; appVersion: string | null; apnsEnvironment: "production" | "sandbox" | null };
type Unregistration = { action: "unregister"; deviceId: string };

export function parse(raw: unknown): Registration | Unregistration | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "invalid_request" };
  const r = raw as Record<string, unknown>;
  if (typeof r.deviceId !== "string" || !UUID_RE.test(r.deviceId)) return { error: "invalid_device_id" };
  if (r.action === "unregister") return Object.keys(r).length === 2 ? { action: "unregister", deviceId: r.deviceId.toLowerCase() } : { error: "invalid_request" };
  if (r.action !== "register") return { error: "invalid_action" };
  const allowed = ["action", "deviceId", "platform", "channel", "token", "appVersion", "apnsEnvironment"];
  if (Object.keys(r).some((k) => !allowed.includes(k))) return { error: "invalid_request" };
  if (r.platform !== "ios" && r.platform !== "android") return { error: "invalid_platform" };
  if (r.channel !== "apns_voip" && r.channel !== "fcm") return { error: "invalid_channel" };
  if ((r.platform === "ios") !== (r.channel === "apns_voip")) return { error: "channel_platform_mismatch" };
  const token = typeof r.token === "string" ? r.token.trim() : "";
  if (r.channel === "apns_voip" ? !/^[0-9a-f]{64,200}$/i.test(token) : !/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) return { error: "invalid_token" };
  const appVersion = r.appVersion === undefined || r.appVersion === null ? null : typeof r.appVersion === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(r.appVersion) ? r.appVersion : "";
  if (appVersion === "") return { error: "invalid_app_version" };
  const env = r.apnsEnvironment === undefined || r.apnsEnvironment === null ? null : r.apnsEnvironment === "production" || r.apnsEnvironment === "sandbox" ? r.apnsEnvironment : "";
  if (env === "") return { error: "invalid_apns_environment" };
  return { action: "register", deviceId: r.deviceId.toLowerCase(), platform: r.platform, channel: r.channel, token: r.channel === "apns_voip" ? token.toLowerCase() : token, appVersion, apnsEnvironment: r.channel === "apns_voip" ? (env ?? "production") : null };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const body = parse(raw);
  if ("error" in body) return respond({ error: body.error }, 400);
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt) return respond({ error: "unauthorized" }, 401);
  const { data, error } = await d.admin.auth.getUser(jwt);
  const userId = data?.user?.id;
  if (error || !userId) return respond({ error: "unauthorized" }, 401);

  if (body.action === "unregister") {
    await d.admin.from("lemtel_push_devices").delete().eq("user_id", userId).eq("device_id", body.deviceId);
    return respond({ ok: true });
  }
  const [{ data: memberships }, { data: orgs }] = await Promise.all([
    d.admin.from("lemtel_organization_memberships").select("organization_id").eq("user_id", userId).eq("status", "active"),
    d.admin.from("lemtel_organizations").select("id").eq("status", "active"),
  ]);
  const active = new Set(((orgs ?? []) as Array<{ id: string }>).map((o) => o.id));
  const orgIds = [...new Set(((memberships ?? []) as Array<{ organization_id: string }>).map((m) => m.organization_id).filter((id) => active.has(id)))];
  if (!orgIds.length) return respond({ error: "no_active_organization" }, 403);
  // A token now belongs to this account only.
  await d.admin.from("lemtel_push_devices").delete().eq("token", body.token).neq("user_id", userId);
  const now = new Date(d.now()).toISOString();
  for (const organizationId of orgIds) {
    const { data: existing } = await d.admin.from("lemtel_push_devices").select("device_id,channel").eq("organization_id", organizationId).eq("user_id", userId);
    const list = (existing ?? []) as Array<{ device_id: string; channel: string }>;
    if (!list.some((x) => x.device_id === body.deviceId && x.channel === body.channel) && list.length >= MAX_DEVICES_PER_USER) return respond({ error: "too_many_devices" }, 409);
    await d.admin.from("lemtel_push_devices").upsert({ organization_id: organizationId, user_id: userId, device_id: body.deviceId, platform: body.platform, channel: body.channel,
      token: body.token, app_version: body.appVersion, apns_environment: body.apnsEnvironment, enabled: true, failure_count: 0, last_seen_at: now }, { onConflict: "organization_id,device_id,channel" });
  }
  return respond({ ok: true, organizations: orgIds.length });
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return respond({ error: "server_not_configured" }, 503);
    return handle(req, { admin: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), now: Date.now });
  });
}
