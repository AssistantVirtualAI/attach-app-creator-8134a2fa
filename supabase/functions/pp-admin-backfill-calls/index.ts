// pp-admin-backfill-calls — Traite en batch tous les appels avec enregistrement
// qui n'ont pas encore de transcription ou d'analyse Claude.
// Peut être invoqué:
//   - par un admin Planipret via le portail (JWT utilisateur)
//   - par pg_cron / service-role (Bearer = SUPABASE_SERVICE_ROLE_KEY) pour auto-traitement.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function processOne(callId: string, downstreamAuth: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/pp-admin-transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: downstreamAuth },
      body: JSON.stringify({ call_id: callId }),
    });
    const j = await r.json().catch(() => ({}));
    return { call_id: callId, ok: r.ok && (j?.ok !== false), status: r.status, detail: j };
  } catch (e) {
    return { call_id: callId, ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Shared secret for pg_cron invocations
    const CRON_SECRET = Deno.env.get("PP_CRON_TOKEN") ?? Deno.env.get("PP_CRON_SECRET") ?? "";

    const auth = req.headers.get("Authorization") ?? "";
    const cronHeader = req.headers.get("x-pp-cron-secret") ?? req.headers.get("X-Pp-Cron-Secret") ?? "";
    console.log("[backfill] headers:", { hasAuth: !!auth, cronHeaderLen: cronHeader.length, secretConfigured: !!CRON_SECRET, match: cronHeader === CRON_SECRET });
    const isCron = CRON_SECRET && cronHeader === CRON_SECRET;
    const token = auth.startsWith("Bearer ") ? auth.replace(/^Bearer\s+/i, "") : "";
    const isServiceRole = token && token === SERVICE_ROLE;

    let downstreamAuth = auth;
    if (isCron || isServiceRole) {
      downstreamAuth = `Bearer ${SERVICE_ROLE}`;
    } else {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const { data: userData } = await admin.auth.getUser(token);
      if (!userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: userData.user.id });
      const { data: isMember } = await admin.rpc("is_planipret_member", { _user_id: userData.user.id });
      if (isAdmin !== true && isMember !== true) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({} as any));
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
    const concurrency = Math.min(Math.max(Number(body.concurrency) || 3, 1), 5);
    const dryRun = body.dry_run === true;

    // Cible: appels avec enregistrement, sans transcript OU sans analyse
    const { data: rows, error } = await admin
      .from("planipret_phone_calls")
      .select("id, has_recording, transcript, analyzed_at, analysis_in_progress, analysis_locked_at")
      .eq("has_recording", true)
      .or("transcript.is.null,analyzed_at.is.null")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) return json({ error: error.message }, 500);

    // Filtrer les verrous actifs (< 2 min)
    const eligible = (rows ?? []).filter((r: any) => {
      if (!r.analysis_in_progress) return true;
      const lockedAt = new Date(r.analysis_locked_at || 0).getTime();
      return Date.now() - lockedAt > 120_000;
    });

    if (dryRun) {
      return json({ eligible_count: eligible.length, ids: eligible.map((r: any) => r.id) });
    }

    // Traitement concurrent limité
    const results: any[] = [];
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < eligible.length) {
        const idx = cursor++;
        const row = eligible[idx];
        const res = await processOne(row.id, downstreamAuth);
        results.push(res);
      }
    });
    await Promise.all(workers);

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    return json({
      total: eligible.length,
      processed: results.length,
      succeeded,
      failed_count: failed.length,
      failed: failed.slice(0, 10),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
