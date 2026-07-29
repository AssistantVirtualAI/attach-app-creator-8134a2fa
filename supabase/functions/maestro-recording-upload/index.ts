// POST /functions/v1/maestro-recording-upload
// Body: { call_id: uuid, force?: boolean }
//
// The Maestro Telecom REST API is READ-ONLY for recordings: the only route is
// `GET /api/v1/users/{brokerId}/calls/{callId}/recording`. There is no upload
// endpoint, so this function is a no-op that records the skip and marks the
// pipeline `recording` step as done. The recording_url is already delivered to
// Maestro through the CDR push (`POST /api/v1/users/{id}/calls`).
import {
  adminClient,
  corsHeaders,
  json,
  pipelineLog,
  setPipelineStep,
} from "../_shared/maestro.ts";

const SKIP_REASON =
  "Maestro Telecom API is read-only for recordings. The recording_url is already sent via CDR push.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { call_id } = await req.json().catch(() => ({} as any));
  const admin = adminClient();

  if (call_id) {
    let userId: string | null = null;
    try {
      const { data: call } = await admin
        .from("planipret_phone_calls")
        .select("id, user_id")
        .eq("id", call_id)
        .maybeSingle();
      userId = call?.user_id ?? null;
    } catch (_) { /* ignore */ }

    await pipelineLog(admin, {
      call_id,
      user_id: userId,
      step: "recording_upload",
      status: "skipped",
      error_message: "no_upload_endpoint",
      payload: { reason: SKIP_REASON },
    });
    await setPipelineStep(admin, call_id, "cdr", "done", { recording: "skipped_no_upload_endpoint" }).catch(() => {});
    try {
      await admin.from("planipret_recording_uploads").upsert({
        call_id,
        user_id: userId,
        status: "skipped",
        error_message: "no_upload_endpoint",
        updated_at: new Date().toISOString(),
      }, { onConflict: "call_id" });
    } catch (_) { /* ignore */ }
  }

  return json({ success: true, skipped: "no_upload_endpoint", reason: SKIP_REASON });
});
