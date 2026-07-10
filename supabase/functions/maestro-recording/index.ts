// GET /functions/v1/maestro-recording?call_id={uuid}
// Returns a signed recording URL from Maestro, caching it on the call row.
import {
  adminClient,
  corsHeaders,
  getBrokerAuth,
  getMaestroConfig,
  json,
  maestroFetch,
} from "../_shared/maestro.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let callId = url.searchParams.get("call_id");
    if (!callId && req.method !== "GET") {
      try {
        const body = await req.json();
        callId = body?.call_id ?? body?.callId ?? null;
      } catch { /* ignore */ }
    }
    if (!callId) return json({ error: "call_id_required" }, 400);

    const admin = adminClient();
    const { data: call } = await admin
      .from("planipret_phone_calls")
      .select("id, user_id, ns_call_id, maestro_call_id, recording_url, metadata")
      .eq("id", callId)
      .maybeSingle();
    if (!call) return json({ error: "call_not_found" }, 404);

    // Cached URL check
    const cached = (call.metadata ?? {}) as Record<string, any>;
    const cachedUrl = cached.maestro_recording_url;
    const cachedExp = cached.maestro_recording_expires_at;
    if (cachedUrl && cachedExp && new Date(cachedExp) > new Date(Date.now() + 60_000)) {
      return json({
        url: cachedUrl,
        expires_at: cachedExp,
        duration_sec: cached.maestro_recording_duration_sec ?? null,
        cached: true,
      });
    }

    const cfg = await getMaestroConfig(admin);
    if (!cfg.url || !cfg.key) {
      // Fallback: return whatever recording_url we already have (from NS-API)
      if (call.recording_url) {
        return json({ url: call.recording_url, recording_url: call.recording_url, expires_at: null, source: "ns" });
      }
      // Planipret uses NS-API — Maestro isn't configured. Don't return 404
      // (that surfaces as a red console error in the client). The primary
      // NS fetch path already reports the real reason if audio is missing.
      return json({ available: false, reason: "maestro_not_configured", url: null, recording_url: null });
    }

    const auth = await getBrokerAuth(admin, call.user_id);
    const maestroCallId = call.maestro_call_id ?? call.ns_call_id ?? call.id;
    const res = await maestroFetch(cfg, {
      method: "GET",
      path: `/api/v1/calls/${encodeURIComponent(maestroCallId)}/recording`,
      token: auth.token,
    });

    if (!res.ok) {
      if (call.recording_url) {
        return json({ url: call.recording_url, recording_url: call.recording_url, expires_at: null, source: "ns" });
      }
      return json({ available: false, reason: "maestro_status_" + res.status, url: null, recording_url: null });
    }

    const data = res.data ?? {};
    const next = {
      ...cached,
      maestro_recording_url: data.url,
      maestro_recording_expires_at: data.expires_at ?? null,
      maestro_recording_duration_sec: data.duration_sec ?? null,
    };
    await admin
      .from("planipret_phone_calls")
      .update({
        recording_url: data.url ?? call.recording_url,
        metadata: next,
      })
      .eq("id", call.id);

    return json({
      url: data.url,
      expires_at: data.expires_at ?? null,
      duration_sec: data.duration_sec ?? null,
      cached: false,
    });
  } catch (e: any) {
    console.error("maestro-recording error", e);
    return json({ error: e?.message ?? "server_error" }, 500);
  }
});
