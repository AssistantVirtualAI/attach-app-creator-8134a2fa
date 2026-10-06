// pp-call-consent — décision du courtier en fin d'appel.
//
// Audio, transcription, résumé IA et coaching restent dans AVA. Le choix du
// courtier contrôle uniquement l'envoi manuel vers Maestro.
//
// Body: { call_id, action: "approve" | "decline" | "delete" | "status",
//         channel?: "voice" | "screen", reason?: string }
// `decline` et `delete` des anciennes apps signifient désormais « garder dans
// AVA » et ne détruisent jamais les médias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, guardPlanipret } from "../_shared/planipret-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CALL_FIELDS =
  "id, user_id, maestro_call_id, maestro_client_id, save_consent, save_consent_at, deleted_at, recording_url, ns_recording_url, recording_storage_path, transcript, ai_summary, ai_coaching, duration_seconds, started_at, from_number, to_number, direction, maestro_client_name";

/** Le courtier possède-t-il cet appel ? (user_id peut pointer sur auth.users ou sur le profil) */
async function ownsCall(admin: any, authUserId: string, callUserId: string | null) {
  if (!callUserId) return false;
  if (callUserId === authUserId) return true;
  const { data } = await admin
    .from("planipret_profiles")
    .select("id, user_id")
    .or(`id.eq.${callUserId},user_id.eq.${callUserId}`)
    .limit(5);
  return (data ?? []).some((p: any) => p.user_id === authUserId || p.id === authUserId);
}

/** Start the approved post-call pipeline and report whether the hand-off reached it.
 * The downstream workflow remains idempotent, so a later approve retry is safe. */
async function startApprovedPipeline(callId: string): Promise<{ started: boolean; stage?: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-auto-process-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ call_id: callId }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      return { started: false, error: String(body?.error ?? `pipeline_http_${response.status}`).slice(0, 160) };
    }
    return { started: true, stage: String(body?.stage ?? body?.skipped ?? "started") };
  } catch (error) {
    return { started: false, error: error instanceof Error ? error.name : "pipeline_start_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await guardPlanipret(req);
  if ("error" in guard) return guard.error;
  const { user } = guard;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const callId = String(body?.call_id ?? "");
  const requestedAction = String(body?.action ?? "status");
  const action = requestedAction === "decline" || requestedAction === "delete" ? "keep" : requestedAction;
  const channel = body?.channel === "voice" ? "voice" : "screen";
  // Heure exacte de fin d'appel telle que mesurée par le téléphone.
  const endedAtRaw = String(body?.ended_at ?? "");
  const endedAt = endedAtRaw && !Number.isNaN(Date.parse(endedAtRaw)) ? new Date(endedAtRaw).toISOString() : null;
  const endedPatch = endedAt ? { ended_at: endedAt } : {};
  if (!callId) return json({ error: "call_id_required" }, 400);

  const { data: call } = await admin
    .from("planipret_phone_calls")
    .select(CALL_FIELDS)
    .eq("id", callId)
    .maybeSingle();
  if (!call) return json({ error: "call_not_found" }, 404);

  const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: user.id });
  if (isAdmin !== true && !(await ownsCall(admin, user.id, call.user_id))) {
    return json({ error: "forbidden" }, 403);
  }

  if (action === "status") return json({ ok: true, call });

  if (action === "approve") {
    if (String(call.save_consent ?? "") === "approved") {
      const pipeline = await startApprovedPipeline(callId);
      return json({
        ok: pipeline.started,
        save_consent: "approved",
        already_approved: true,
        processing: pipeline.started ? pipeline.stage : "retryable",
        processing_error: pipeline.error ?? null,
      }, pipeline.started ? 200 : 202);
    }
    const { data: approved, error: approveError } = await admin.from("planipret_phone_calls").update({
      save_consent: "approved",
      ...endedPatch,
      save_consent_at: new Date().toISOString(),
      save_consent_by: user.id,
      save_consent_channel: channel,
    }).eq("id", callId)
      .or("save_consent.is.null,save_consent.neq.approved")
      .select("id")
      .maybeSingle();
    if (approveError) return json({ error: "consent_update_failed" }, 500);
    if (!approved) return json({ ok: true, save_consent: "approved", already_approved: true });

    // Lance la chaîne AVA. L'envoi Maestro exige ensuite un clic CRM explicite.
    const pipeline = await startApprovedPipeline(callId);
    return json({
      ok: pipeline.started,
      save_consent: "approved",
      processing: pipeline.started ? pipeline.stage : "retryable",
      processing_error: pipeline.error ?? null,
    }, pipeline.started ? 200 : 202);
  }

  if (action === "keep") {
    const now = new Date().toISOString();
    const { error: keepError } = await admin.from("planipret_phone_calls").update({
      save_consent: "declined",
      ...endedPatch,
      save_consent_at: now,
      save_consent_by: user.id,
      save_consent_channel: channel,
    }).eq("id", callId);
    if (keepError) return json({ error: "consent_update_failed" }, 500);
    const pipeline = await startApprovedPipeline(callId);
    return json({ ok: true, kept_in_ava: true, save_consent: "declined", processing: pipeline.started ? pipeline.stage : "retryable" }, pipeline.started ? 200 : 202);
  }

  return json({ error: "unknown_action" }, 400);
});
