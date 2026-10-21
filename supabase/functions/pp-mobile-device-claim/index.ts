// pp-mobile-device-claim — keeps exactly one active mobile device per broker.
// action "claim": atomically defers during ringing/active calls; otherwise this
// device becomes active and other devices' tokens are revoked (never deleted).
// action "check": tells the caller whether it is still the active device.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeDeviceId, readActiveDevice } from "../_shared/pp-active-device.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "missing_auth" }, 401);
    const { data: u, error: uErr } = await createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }).auth.getUser();
    if (uErr || !u?.user) return json({ error: "invalid_session" }, 401);
    const userId = u.user.id;

    const body = await req.json().catch(() => ({}));
    const action = body?.action === "check" ? "check" : body?.action === "claim" ? "claim" : null;
    const deviceId = normalizeDeviceId(body?.device_id);
    const platform = ["ios", "android"].includes(String(body?.platform)) ? String(body.platform) : null;
    if (!action || !deviceId || (action === "claim" && !platform)) return json({ error: "invalid_request" }, 400);

    const admin = createClient(url, service);

    if (action === "check") {
      const active = await readActiveDevice(admin, userId);
      if (active && active !== deviceId) return json({ ok: true, active: false });
      if (!active) {
        // First run after the update: adopt this device without revoking anyone.
        await admin.from("planipret_mobile_active_device").upsert(
          { user_id: userId, device_id: deviceId, platform, activated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      }
      return json({ ok: true, active: true });
    }

    const { data, error } = await admin.rpc("pp_claim_mobile_device", {
      _user_id: userId,
      _device_id: deviceId,
      _platform: platform,
    });
    const result = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !result) return json({ error: "claim_failed" }, 500);
    if (result.deferred === true) {
      return json({ ok: true, active: false, deferred: true, retry_after_seconds: 10 });
    }
    if (result.active !== true) return json({ error: "claim_failed" }, 500);
    return json({ ok: true, active: true, replaced: result.replaced === true });
  } catch (e) {
    console.error("[pp-mobile-device-claim] error", e instanceof Error ? e.message : String(e));
    return json({ error: "internal_error" }, 500);
  }
});
