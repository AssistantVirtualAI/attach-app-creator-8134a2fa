// Read-only GET of a Maestro call / message thread for the signed-in broker's own call.
import { adminClient, corsHeaders, getBrokerAuth, getMaestroConfig, json, maestroFetch } from "../_shared/maestro.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = adminClient();
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);
  const { call_id } = await req.json().catch(() => ({}));
  if (!call_id) return json({ ok: false, error: "call_id_required" }, 400);
  const { data: prof } = await admin.from("planipret_profiles").select("id").eq("user_id", u.user.id).maybeSingle();
  const { data: call } = await admin.from("planipret_phone_calls").select("id,user_id,maestro_call_id")
    .eq("id", call_id).maybeSingle();
  if (!call || (call.user_id !== u.user.id && call.user_id !== prof?.id)) return json({ ok: false, error: "forbidden" }, 403);
  const cfg = await getMaestroConfig(admin);
  const auth = await getBrokerAuth(admin, call.user_id);
  const res = await maestroFetch(cfg, {
    method: "GET",
    path: `/api/v1/users/${encodeURIComponent(String(auth.brokerId))}/calls/${encodeURIComponent(String(call.maestro_call_id))}`,
    token: auth.token,
  });
  const d: any = (res.data as any)?.data ?? res.data;
  return json({
    ok: res.ok, status: res.status,
    id: d?.id, status_field: d?.status, duration: d?.duration_seconds,
    transcript_len: typeof d?.transcript === "string" ? d.transcript.length : 0,
    ai_summary_len: typeof d?.ai_summary === "string" ? d.ai_summary.length : 0,
    notes_has_coaching: typeof d?.notes === "string" && d.notes.includes("Coaching IA"),
    recording: !!d?.call_recording_filename,
    saving_call_transcript: d?.saving_call_transcript,
  });
});
