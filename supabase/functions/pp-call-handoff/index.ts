import { z } from "npm:zod@3";
import { corsHeaders, jsonResponse, requirePlanipretBroker, nsFetch } from "../_shared/planipret-ns.ts";
import { bareAorId, mobileDeviceId, widgetDeviceId } from "../_shared/pp-device-ids.ts";

const input = z.union([
  z.object({ action: z.literal("status"), target: z.enum(["mobile", "widget"]).default("widget") }).strict(),
  z.object({ target: z.enum(["mobile", "widget"]), call_id: z.string().trim().min(1).max(512).optional() }).strict(),
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
    // No existing inbound Maestro machine-key verifier: JWT only. The shared
    // broker guard validates claims/getUser; explicitly exclude its service path.
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return reply(false, "refused", "unauthorized", 401);
    const guard = await requirePlanipretBroker(req);
    if (guard instanceof Response) return reply(false, "refused", "authentication_or_profile", guard.status === 200 ? 403 : guard.status);
    const raw = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json();
    const parsed = input.safeParse(raw);
    if (!parsed.success) return reply(false, "refused", "invalid_input", 400);
    const { ctx, supabase } = guard;
    const { data: profile, error } = await supabase.from("planipret_profiles")
      .select("ns_mobile_device_id, ns_widget_device_id").eq("user_id", ctx.userId).maybeSingle();
    if (error || !profile) return reply(false, "refused", "profile_unavailable", 403);
    const p = parsed.data;
    const device = p.target === "mobile" ? profile.ns_mobile_device_id || mobileDeviceId(ctx.extension) : profile.ns_widget_device_id || widgetDeviceId(ctx.extension);
    const base = `/domains/${encodeURIComponent(ctx.nsDomain)}/users/${encodeURIComponent(ctx.extension)}`;
    // Reading under /users/{own extension}/devices also verifies device ownership.
    const dr = await nsFetch(`${base}/devices/${encodeURIComponent(device)}`, { method: "GET" });
    if (!dr.ok) return reply(false, "unavailable", "device_lookup_failed", 502);
    const body = await dr.json();
    const d = Array.isArray(body) ? body[0] : body;
    const registered = String(d?.["device-sip-registration-state"] ?? d?.["registration-state"] ?? "").toLowerCase() === "registered";
    if ("action" in p) return jsonResponse({ ok: true, status: "ready", error_code: null, registered });
    if (!registered) return reply(false, "unavailable", "target_not_registered", 409);
    const cr = await nsFetch(`${base}/calls`, { method: "GET" });
    if (!cr.ok) return reply(false, "unavailable", "call_lookup_failed", 502);
    const calls = await cr.json();
    const rows = Array.isArray(calls) ? calls : calls?.calls ?? calls?.data ?? [];
    const call = selectOwnedCall(Array.isArray(rows) ? rows : [], ctx.extension, p.call_id);
    if (!call) return reply(false, "refused", "call_not_owned_or_ambiguous", 403);
    const result = await nsFetch(`${base}/calls/${encodeURIComponent(callId(call))}/transfer`, {
      method: "PATCH", body: JSON.stringify({ destination: `${bareAorId(device)}@${ctx.nsDomain}` }),
    });
    return result.ok ? reply(true, "handoff_requested") : reply(false, "failed", "provider_refused", 502);
  } catch { return reply(false, "failed", "request_failed", 500); }
}
if (import.meta.main) Deno.serve(handler);
