// pp-mobile-device-claim — keeps exactly one active mobile device per broker.
// action "claim": this device becomes active; push/VoIP tokens of every other
// device are revoked (never deleted) so only this phone rings.
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
    if (!action || !deviceId) return json({ error: "invalid_request" }, 400);

    const admin = createClient(url, service);
    const active = await readActiveDevice(admin, userId);

    if (action === "check") {
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

    const now = new Date().toISOString();
    const { error: upErr } = await admin.from("planipret_mobile_active_device").upsert(
      { user_id: userId, device_id: deviceId, platform, activated_at: now },
      { onConflict: "user_id" },
    );
    if (upErr) return json({ error: "claim_failed" }, 500);

    const revoked = { voip: 0, push: 0 };
    for (const table of ["planipret_voip_push_tokens", "mobile_push_tokens"] as const) {
      const { data } = await admin.from(table)
        .update({ revoked_at: now })
        .eq("user_id", userId)
        .is("revoked_at", null)
        .or(`device_id.is.null,device_id.neq.${deviceId}`)
        .select("id");
      if (table === "planipret_voip_push_tokens") revoked.voip = data?.length ?? 0;
      else revoked.push = data?.length ?? 0;
      await admin.from(table).update({ revoked_at: null }).eq("user_id", userId).eq("device_id", deviceId);
    }
    console.log("[pp-mobile-device-claim] claimed", { user: userId.slice(0, 8), replaced: active && active !== deviceId, revoked });
    return json({ ok: true, active: true, replaced: Boolean(active && active !== deviceId) });
  } catch (e) {
    console.error("[pp-mobile-device-claim] error", e instanceof Error ? e.message : String(e));
    return json({ error: "internal_error" }, 500);
  }
});
