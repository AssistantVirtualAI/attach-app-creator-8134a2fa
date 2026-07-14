// pp-auto-process-call — DB trigger entrypoint.
// Ensures every call with a recording is transcribed and analyzed exactly once,
// server-side, so both admin portal and broker mobile app see the same result
// via Realtime without ever double-billing STT/Claude tokens.
//
// The heavy lifting is delegated:
//   1. pp-admin-transcribe → NetSapiens transcript (fallback: Lovable AI STT)
//   2. pp-coach-call       → correction + coaching + summary (atomic lock)
//
// Both downstream functions are idempotent (they read `analyzed_at` /
// `transcript` / `analysis_in_progress` before doing any work), so it's safe
// to retry this endpoint.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const callId: string | undefined = body?.call_id ?? body?.record?.id;
  if (!callId) return json({ error: "call_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: row, error } = await admin
    .from("planipret_phone_calls")
    .select("id, recording_url, transcript, transcript_raw, analyzed_at, analysis_in_progress, analysis_locked_at")
    .eq("id", callId)
    .maybeSingle();
  if (error) return json({ error: "load failed", details: error.message }, 500);
  if (!row) return json({ error: "call not found" }, 404);

  // Idempotency short-circuits — cheap and avoids any downstream cost.
  if (row.analyzed_at) return json({ ok: true, skipped: "already_analyzed" });
  if (row.analysis_in_progress) {
    const lockedAt = new Date(row.analysis_locked_at || 0).getTime();
    if (Date.now() - lockedAt < 5 * 60_000) {
      return json({ ok: true, skipped: "locked_elsewhere" });
    }
  }
  if (!row.recording_url) return json({ ok: true, skipped: "no_recording_yet" });

  const authHeader = `Bearer ${SERVICE_ROLE}`;

  // Step 1 — ensure transcript exists. pp-admin-transcribe backs off if the
  // recording isn't fetchable yet (returns { pending: true }) — trigger will
  // fire again on the next recording_url / transcript update.
  let transcript = row.transcript ?? row.raw_transcript ?? null;
  if (!transcript || transcript.trim().length < 20) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/pp-admin-transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ call_id: callId }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.transcript) transcript = j.transcript;
      if (j?.pending) return json({ ok: true, pending: true, stage: "transcribe" });
      // pp-admin-transcribe already re-invokes pp-coach-call when it produced
      // the transcript itself, so nothing more to do here.
      if (j?.ok && !row.analyzed_at) return json({ ok: true, stage: "transcribed" });
    } catch (e: any) {
      return json({ ok: false, stage: "transcribe", error: e?.message }, 500);
    }
  }

  // Step 2 — analyse (only if we now have a transcript and it wasn't already
  // covered by pp-admin-transcribe's own coach-call invocation).
  if (transcript && transcript.trim().length >= 20) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/pp-coach-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ call_id: callId }),
      });
      const j = await r.json().catch(() => ({}));
      return json({ ok: true, stage: "analyze", result: j });
    } catch (e: any) {
      return json({ ok: false, stage: "analyze", error: e?.message }, 500);
    }
  }

  return json({ ok: true, skipped: "no_transcript_yet" });
});
