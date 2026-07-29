// POST /functions/v1/maestro-recording-upload
// Body: { call_id: uuid, force?: boolean }
//
// Per Scott (Maestro): there is NO upload endpoint for recordings/transcripts —
// Maestro generates both server-side once the call is marked as finished.
// The correct flow is:
//   1. PUT /api/v1/users/{brokerId}/calls/{callId}  { status: "ended" }
//   2. Periodically GET .../calls/{callId}/recording and .../transcription
//      until the media is ready (handled by `maestro-media-poll`).
import {
  adminClient,
  corsHeaders,
  getMaestroConfig,
  json,
  maestroFetch,
  pipelineLog,
  setPipelineStep,
  telecomAuth,
} from "../_shared/maestro.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { call_id } = await req.json().catch(() => ({} as any));
  if (!call_id) return json({ success: false, error: "call_id_required" }, 400);

  const admin = adminClient();
  const { data: call } = await admin
    .from("planipret_phone_calls")
    .select("id, user_id, maestro_call_id, metadata")
    .eq("id", call_id)
    .maybeSingle();

  const userId = call?.user_id ?? null;
  const maestroCallId = (call as any)?.maestro_call_id ?? null;

  if (!maestroCallId) {
    await pipelineLog(admin, {
      call_id, user_id: userId, step: "recording_upload", status: "skipped",
      error_message: "maestro_call_id_missing",
    });
    await admin.from("planipret_recording_uploads").upsert({
      call_id, user_id: userId, status: "skipped",
      error_message: "maestro_call_id_missing", updated_at: new Date().toISOString(),
    }, { onConflict: "call_id" }).then(() => {}, () => {});
    return json({ success: false, error: "maestro_call_id_missing" });
  }

  const cfg = await getMaestroConfig(admin);
  const auth = await telecomAuth(admin, userId ?? "");
  if (!cfg.url || !cfg.key || !auth.brokerId) {
    return json({ success: false, error: !auth.brokerId ? "maestro_broker_id_missing" : "maestro_not_configured" });
  }

  // 1) Mark the call as ended so Maestro starts generating media.
  const res = await maestroFetch(cfg, {
    method: "PUT",
    path: `/api/v1/users/${encodeURIComponent(String(auth.brokerId))}/calls/${encodeURIComponent(String(maestroCallId))}`,
    token: auth.token,
    body: { status: "ended" },
  });
  console.log(`[maestro-recording-upload] call=${call_id} mark_ended ok=${res.ok} status=${res.status}`);

  const meta = ((call as any)?.metadata ?? {}) as Record<string, unknown>;
  await admin.from("planipret_phone_calls").update({
    metadata: {
      ...meta,
      maestro_marked_ended_at: res.ok ? new Date().toISOString() : (meta.maestro_marked_ended_at ?? null),
      maestro_media_pending: true,
    },
  }).eq("id", call_id);

  await pipelineLog(admin, {
    call_id, user_id: userId, step: "recording_upload",
    status: res.ok ? "success" : "error",
    error_message: res.ok ? null : `mark_ended_http_${res.status}`,
    payload: { maestro_call_id: maestroCallId, status: res.status, mode: "mark_ended_then_poll" },
  });
  await setPipelineStep(admin, call_id, "cdr", "done", { recording: res.ok ? "pending_maestro_generation" : "mark_ended_failed" }).catch(() => {});
  await admin.from("planipret_recording_uploads").upsert({
    call_id, user_id: userId,
    status: res.ok ? "pending" : "error",
    error_message: res.ok ? null : `mark_ended_http_${res.status}`,
    updated_at: new Date().toISOString(),
  }, { onConflict: "call_id" }).then(() => {}, () => {});

  // 2) Opportunistic first poll (media is usually not ready yet).
  let media: unknown = null;
  try {
    const poll = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maestro-media-poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ call_id }),
    });
    media = await poll.json().catch(() => null);
  } catch { /* ignore */ }

  return json({ success: res.ok, mode: "mark_ended_then_poll", status: res.status, maestro_call_id: maestroCallId, media });
});
