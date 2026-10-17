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
const isRow = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
function callRows(value: unknown): Row[] | null {
  const rows = Array.isArray(value) ? value : isRow(value) ? value.calls ?? value.data ?? [value] : null;
  if (!Array.isArray(rows) || !rows.every(isRow)) return null;
  return rows;
}
/** The list is fetched ONLY from the authenticated extension's scoped endpoint.
 * Selection is NOT evidence of active state: a fresh scoped read is mandatory.
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

type BrokerContext = { extension: string; nsDomain: string };
type Dependencies = {
  env: (name: string) => string | undefined;
  broker: (req: Request) => Promise<{ ctx: BrokerContext } | Response>;
  machineBroker: (maestroId: string) => Promise<BrokerContext | null>;
  provider: (path: string, init: RequestInit) => Promise<Response>;
};
async function resolveMachineBroker(maestroId: string): Promise<BrokerContext | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return null;
  const admin = createClient(url, service);
  const { data: profile, error } = await admin.from("planipret_profiles")
    .select("user_id,extension,ns_extension,ns_domain")
    .eq("organization_id", AVA_ORG_ID).eq("maestro_broker_id", maestroId).single();
  if (error || !profile?.user_id || !profile.ns_domain || !(profile.extension || profile.ns_extension)) return null;
  return { extension: profile.extension || profile.ns_extension, nsDomain: profile.ns_domain };
}

/** JWT path: verified broker guard owns the extension; no supplied broker id.
 * Widget machine path: secret is server-only, user_id is a Maestro lookup key,
 * never a trusted local broker identity. Only the unique server profile owns it.
 * Dependencies are injected only by local tests, never by request input. */
export function createHandler(deps: Dependencies) {
return async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return reply(false, "refused", "method_not_allowed", 405);
  try {
    const authorization = req.headers.get("Authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!token || token === deps.env("SUPABASE_SERVICE_ROLE_KEY")) return reply(false, "refused", "unauthorized", 401);
    let raw: unknown;
    try { raw = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json(); }
    catch { return reply(false, "refused", "invalid_input", 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return reply(false, "refused", "invalid_input", 400);
    let guard;
    const machineKey = deps.env("MAESTRO_MACHINE_API_KEY");
    if (machineKey && token === machineKey) {
      if (!parsed.data.user_id) return reply(false, "refused", "invalid_input", 400);
      const ctx = await deps.machineBroker(parsed.data.user_id);
      if (!ctx) return reply(false, "refused", "profile_unavailable", 403);
      guard = { ctx };
    } else {
      if (parsed.data.user_id) return reply(false, "refused", "invalid_input", 400);
      guard = await deps.broker(req);
      if (guard instanceof Response) return reply(false, "refused", "authentication_or_profile", guard.status === 200 ? 403 : guard.status);
    }
    const { ctx } = guard;
    if (!ctx.extension || !ctx.nsDomain) return reply(false, "refused", "profile_unavailable", 403);
    const p = parsed.data;
    const device = p.target === "mobile" ? mobileDeviceId(ctx.extension) : widgetDeviceId(ctx.extension);
    const base = `/domains/${encodeURIComponent(ctx.nsDomain)}/users/${encodeURIComponent(ctx.extension)}`;
    // Prefer registrations; v45 installations may expose registration on Device only.
    let dr = await deps.provider(`${base}/registrations`, { method: "GET" });
    const deviceFallback = dr.status === 404 || dr.status === 405;
    if (deviceFallback) {
      await dr.text();
      dr = await deps.provider(`${base}/devices/${encodeURIComponent(device)}`, { method: "GET" });
    }
    if (!dr.ok) { await dr.text(); return reply(false, "unavailable", "device_lookup_failed", 502); }
    const body = await dr.json();
    const rowsRegistered = Array.isArray(body) ? body : body?.registrations ?? body?.data ?? [body];
    if (!Array.isArray(rowsRegistered) || !rowsRegistered.every(isRow)) return reply(false, "unavailable", "device_lookup_failed", 502);
    const registered = rowsRegistered.some((d: Row) => {
      const aor = bareAorId(d["device-sip-registration-uri"] ?? d.aor ?? d.device ?? d["aor-user"]);
      const expires = d["device-sip-registration-expires-datetime"] ?? d.expires_at;
      return (aor === device || (deviceFallback && !aor)) &&
        String(d["device-sip-registration-state"] ?? d["registration-state"] ?? d.state ?? "").toLowerCase() === "registered" &&
        (!expires || Date.parse(String(expires)) > Date.now());
    });
    if ("action" in p) return jsonResponse({ registered });
    if (!registered) return reply(false, "unavailable", "target_not_registered", 409);
    const cr = await deps.provider(`${base}/calls`, { method: "GET" });
    if (!cr.ok) { await cr.text(); return reply(false, "unavailable", "call_lookup_failed", 502); }
    const calls = await cr.json();
    const rows = callRows(calls);
    const call = rows ? selectOwnedCall(rows, ctx.extension, p.call_id) : null;
    if (!call) return reply(false, "refused", "call_not_owned_or_ambiguous", 403);
    // docs/netsapiens/calls.md:16–17 documents list/read ACTIVE calls, but
    // no lifecycle/deletion fields or enums. Never invent status/deleted flags.
    // Re-read this exact call under the resolved owner immediately before transfer.
    // Ended/deleted calls must disappear from this active resource. Missing,
    // failed, malformed, multiple or mismatching evidence is fail-closed.
    const activeResponse = await deps.provider(`${base}/calls/${encodeURIComponent(callId(call))}`, { method: "GET" });
    if (!activeResponse.ok) {
      await activeResponse.text();
      return reply(false, "refused", "call_active_unconfirmed", 409);
    }
    let activeRows: Row[] | null;
    try { activeRows = callRows(await activeResponse.json()); }
    catch { return reply(false, "refused", "call_active_unconfirmed", 409); }
    const active = activeRows?.length === 1 ? selectOwnedCall(activeRows, ctx.extension, callId(call)) : null;
    if (!active) return reply(false, "refused", "call_active_unconfirmed", 409);
    const remoteLeg = String(active["call-remote-call-id"] ?? active["remote-call-id"] ?? active.remote_call_id ?? "");
    if (!remoteLeg) return reply(false, "refused", "remote_leg_unavailable", 409);
    // Never DELETE/hang up the source. Completion/rollback belongs to NS.
    const result = await deps.provider(`${base}/calls/${encodeURIComponent(remoteLeg)}/transfer`, {
      method: "PATCH", body: JSON.stringify({ destination: `sip:${device}@${ctx.nsDomain}` }),
    });
    await result.text();
    // Provider acceptance only. Not confirmation of answer or delivery to target.
    return result.ok ? reply(true, "handoff_requested") : reply(false, "failed", "provider_refused", 502);
  } catch { return reply(false, "failed", "request_failed", 500); }
};
}
export const handler = createHandler({
  env: (name) => Deno.env.get(name),
  broker: requirePlanipretBroker,
  machineBroker: resolveMachineBroker,
  provider: nsFetch,
});
if (import.meta.main) Deno.serve(handler);
