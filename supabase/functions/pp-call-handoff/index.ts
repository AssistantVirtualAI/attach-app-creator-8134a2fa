import { createClient } from "npm:@supabase/supabase-js@2";
import { AVA_ORG_ID } from "../_shared/planipret-ns.ts";
import { z } from "npm:zod@3";
import { corsHeaders, jsonResponse, requirePlanipretBroker, nsFetch } from "../_shared/planipret-ns.ts";
import { bareAorId, mobileDeviceId, widgetDeviceId } from "../_shared/pp-device-ids.ts";

const input = z.union([
  z.object({ action: z.literal("status"), target: z.enum(["mobile", "widget"]).default("widget") , user_id: z.string().trim().min(1).max(128).optional() }).strict(),
  z.object({ target: z.enum(["mobile", "widget"]), call_id: z.string().trim().min(1).max(512).optional() , user_id: z.string().trim().min(1).max(128).optional() }).strict(),
]);
type Row = Record<string, unknown>;
const callId = (r: Row) => String(r["call-id"] ?? r.call_id ?? r.id ?? "");
/** The list is fetched ONLY from the authenticated extension's scoped endpoint.
 * Explicit ownership fields, when present, must also match that extension. */
export function selectOwnedCall(rows: Row[], extension: string, requested?: string): Row | null {
  const candidates = rows.filter((r) => {
    const owners = [r.user, r.extension, r["user-name"]].filter((v) => v != null);
    return callId(r) && owners.every((v) => bareAorId(v) === extension) && (!requested || callId(r) === requested);
  });
  return candidates.length === 1 ? candidates[0] : null;
}
const reply = (ok: boolean, status: string, error_code: string | null = null, http = 200) =>
  jsonResponse({ ok, status, error_code }, http);

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return reply(false, "refused", "method_not_allowed", 405);
  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return reply(false, "refused", "unauthorized", 401);
    const raw = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json();
    const parsed = input.safeParse(raw);
    if (!parsed.success) return reply(false, "refused", "invalid_input", 400);
    let guard;
    const machineKey = Deno.env.get("MAESTRO_MACHINE_API_KEY");
    if (machineKey && token === machineKey) {
      if (!parsed.data.user_id) return reply(false, "refused", "invalid_input", 400);
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: profile, error } = await admin.from("planipret_profiles")
        .select("user_id,extension,ns_extension,ns_domain")
        .eq("organization_id", AVA_ORG_ID).eq("maestro_broker_id", parsed.data.user_id).single();
      if (error || !profile?.ns_domain || !(profile.extension || profile.ns_extension)) return reply(false, "refused", "profile_unavailable", 403);
      guard = { ctx: { extension: profile.extension || profile.ns_extension, nsDomain: profile.ns_domain } };
    } else {
      if (parsed.data.user_id) return reply(false, "refused", "invalid_input", 400);
      guard = await requirePlanipretBroker(req);
      if (guard instanceof Response) return reply(false, "refused", "authentication_or_profile", guard.status === 200 ? 403 : guard.status);
    }
    const { ctx } = guard;
    const p = parsed.data;
    const device = p.target === "mobile" ? mobileDeviceId(ctx.extension) : widgetDeviceId(ctx.extension);
    const base = `/domains/${encodeURIComponent(ctx.nsDomain)}/users/${encodeURIComponent(ctx.extension)}`;
    // Prefer registrations; v45 installations may expose registration on Device only.
    let dr = await nsFetch(`${base}/registrations`, { method: "GET" });
    const deviceFallback = dr.status === 404 || dr.status === 405;
    if (deviceFallback) dr = await nsFetch(`${base}/devices/${encodeURIComponent(device)}`, { method: "GET" });
    if (!dr.ok) return reply(false, "unavailable", "device_lookup_failed", 502);
    const body = await dr.json();
    const rowsRegistered = Array.isArray(body) ? body : body?.registrations ?? body?.data ?? [body];
    const registered = rowsRegistered.some((d: Row) => {
      const aor = bareAorId(d["device-sip-registration-uri"] ?? d.aor ?? d.device ?? d["aor-user"]);
      const expires = d["device-sip-registration-expires-datetime"] ?? d.expires_at;
      return (aor === device || (deviceFallback && !aor)) &&
        String(d["device-sip-registration-state"] ?? d["registration-state"] ?? d.state ?? "").toLowerCase() === "registered" &&
        (!expires || Date.parse(String(expires)) > Date.now());
    });
    if ("action" in p) return jsonResponse({ registered });
    if (!registered) return reply(false, "unavailable", "target_not_registered", 409);
    const cr = await nsFetch(`${base}/calls`, { method: "GET" });
    if (!cr.ok) return reply(false, "unavailable", "call_lookup_failed", 502);
    const calls = await cr.json();
    const rows = Array.isArray(calls) ? calls : calls?.calls ?? calls?.data ?? [];
    const call = selectOwnedCall(Array.isArray(rows) ? rows : [], ctx.extension, p.call_id);
    if (!call) return reply(false, "refused", "call_not_owned_or_ambiguous", 403);
    const remoteLeg = String(call["call-remote-call-id"] ?? call["remote-call-id"] ?? call.remote_call_id ?? "");
    if (!remoteLeg) return reply(false, "refused", "remote_leg_unavailable", 409);
    // Never DELETE/hang up the source. Completion/rollback belongs to NS.
    const result = await nsFetch(`${base}/calls/${encodeURIComponent(remoteLeg)}/transfer`, {
      method: "PATCH", body: JSON.stringify({ destination: `sip:${device}@${ctx.nsDomain}` }),
    });
    return result.ok ? reply(true, "handoff_requested") : reply(false, "failed", "provider_refused", 502);
  } catch { return reply(false, "failed", "request_failed", 500); }
}
if (import.meta.main) Deno.serve(handler);
