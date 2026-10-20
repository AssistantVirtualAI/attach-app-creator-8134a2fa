// Lemtel — wake the called user's apps for an incoming call. Called ONLY by the Lemtel SIP edge (Kamailio) with an
// HMAC-SHA256 signature (LEMTEL_PUSH_HOOK_SECRET), a timestamp within 30 s and a single-use nonce. The edge then holds
// the INVITE until the woken app re-registers (tsilo), exactly like Ringotel's push gateway.
import { createClient } from "npm:@supabase/supabase-js@2";
import { apnsConfig, fcmConfig, hookSignature, sanitizeCall, sendApnsVoip, sendFcm, timingSafeEqualHex, type Env, type Fetch, type SendResult } from "../_shared/lemtelPush.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = { admin: Admin; env: Env; fetch: Fetch; now: () => number };

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const secret = d.env("LEMTEL_PUSH_HOOK_SECRET") ?? "";
  if (!/^[0-9a-f]{64,128}$/.test(secret)) return respond({ error: "push_hook_not_configured" }, 503);
  const ts = req.headers.get("X-Lemtel-Timestamp") ?? "", nonce = req.headers.get("X-Lemtel-Nonce") ?? "", sig = (req.headers.get("X-Lemtel-Signature") ?? "").toLowerCase();
  const text = await req.text();
  if (text.length > 4096 || !/^\d{10}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return respond({ error: "unauthorized" }, 401);
  if (Math.abs(d.now() / 1000 - Number(ts)) > 30) return respond({ error: "unauthorized" }, 401);
  if (!timingSafeEqualHex(await hookSignature(secret, ts, nonce, text), sig)) return respond({ error: "unauthorized" }, 401);
  const { error: replay } = await d.admin.from("lemtel_push_hook_nonces").insert({ nonce });
  if (replay) return respond({ error: "unauthorized" }, 401);
  await d.admin.from("lemtel_push_hook_nonces").delete().lt("seen_at", new Date(d.now() - 10 * 60_000).toISOString());

  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return respond({ error: "invalid_json" }, 400); }
  const sipDomain = typeof body.sipDomain === "string" ? body.sipDomain.toLowerCase() : "";
  const extension = typeof body.extension === "string" ? body.extension : "";
  if (!/^[a-z0-9.-]{3,253}$/.test(sipDomain) || !/^[0-9]{2,8}$/.test(extension)) return respond({ error: "invalid_target" }, 400);
  const call = sanitizeCall({ callRef: body.callRef, fromNumber: body.fromNumber, fromName: body.fromName }, d.now());
  if (!call) return respond({ error: "invalid_call" }, 400);

  const { data: conn } = await d.admin.from("lemtel_pbx_connections").select("organization_id,state").eq("sip_domain", sipDomain).eq("state", "active").maybeSingle();
  if (!conn?.organization_id) return respond({ status: "no_active_organization", devices: 0 });
  const org = conn.organization_id;
  const record = (outcome: string, devices = 0, accepted = 0, failed = 0) => d.admin.from("lemtel_push_events").insert({ organization_id: org, call_ref: call.callRef, extension, devices, accepted, failed, outcome });
  const { data: assignment } = await d.admin.from("lemtel_pbx_extension_assignments").select("user_id,state").eq("organization_id", org).eq("extension", extension).maybeSingle();
  if (!assignment?.user_id || assignment.state !== "assigned") { await record("extension_not_assigned"); return respond({ status: "extension_not_assigned", devices: 0 }); }
  const { data: devices } = await d.admin.from("lemtel_push_devices").select("device_id,channel,token,apns_environment,failure_count").eq("organization_id", org).eq("user_id", assignment.user_id).eq("enabled", true);
  const list = (devices ?? []) as Array<{ device_id: string; channel: "apns_voip" | "fcm"; token: string; apns_environment: "production" | "sandbox" | null; failure_count: number }>;
  if (!list.length) { await record("no_device"); return respond({ status: "no_device", devices: 0 }); }

  const [apns, fcm] = await Promise.all([list.some((x) => x.channel === "apns_voip") ? apnsConfig(d.env) : null, list.some((x) => x.channel === "fcm") ? fcmConfig(d.env) : null]);
  let accepted = 0, failed = 0;
  const results = await Promise.all(list.map(async (dev): Promise<[typeof dev, SendResult]> => {
    if (dev.channel === "apns_voip") return [dev, apns ? await sendApnsVoip(apns, dev.token, dev.apns_environment ?? "production", call, d.now(), d.fetch) : { ok: false, permanent: false, reason: "apns_not_configured" }];
    return [dev, fcm ? await sendFcm(fcm, dev.token, call, d.now(), d.fetch) : { ok: false, permanent: false, reason: "fcm_not_configured" }];
  }));
  const now = new Date(d.now()).toISOString();
  for (const [dev, r] of results) {
    if (r.ok) { accepted++; await d.admin.from("lemtel_push_devices").update({ last_push_at: now, failure_count: 0 }).eq("organization_id", org).eq("device_id", dev.device_id).eq("channel", dev.channel); continue; }
    failed++;
    await d.admin.from("lemtel_push_devices").update(r.permanent ? { enabled: false, failure_count: dev.failure_count + 1 } : { failure_count: dev.failure_count + 1 })
      .eq("organization_id", org).eq("device_id", dev.device_id).eq("channel", dev.channel);
  }
  const reasons = [...new Set(results.filter(([, r]) => !r.ok).map(([, r]) => (r as { reason: string }).reason))].slice(0, 4);
  await record(accepted ? "pushed" : "push_failed", list.length, accepted, failed);
  return respond({ status: accepted ? "pushed" : "push_failed", devices: list.length, accepted, failed, reasons });
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return respond({ error: "server_not_configured" }, 503);
    return handle(req, { admin: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), env: (n) => Deno.env.get(n), fetch, now: Date.now });
  });
}
