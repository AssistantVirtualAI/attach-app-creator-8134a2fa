// Synchronise les tâches Maestro des courtiers dans la projection locale
// (planipret_tasks_projection), pour le tableau admin et l'app mobile.
//
// Source unique : `planipret-task-api` (action "list"), la même route que
// l'app mobile et le portail. Le balayeur ne parle jamais directement à
// Maestro : la résolution d'identifiant, le filtrage par assignation et la
// projection restent dans un seul endroit testé.
//
// Par courtier :
//  - délai de rafraîchissement (`stale_minutes`, 45 min par défaut) : un
//    courtier synchronisé récemment est ignoré sauf si `force` est demandé;
//  - historique : chaque tentative écrit une ligne dans
//    `planipret_task_sync_runs` (succès, nombre de tâches, erreur, durée).
import { corsHeaders, jsonResponse, supaAdmin } from "../_shared/ns-broker.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => ({} as any));
  const limit = Math.min(Number(body?.limit ?? 250), 500);
  const force = body?.force === true || body?.force === 1 || body?.force === "1";
  const staleMinutes = Math.max(0, Number(body?.stale_minutes ?? 45));
  const admin = supaAdmin();

  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let q = admin
    .from("planipret_profiles")
    .select("user_id, maestro_broker_id, full_name")
    .not("user_id", "is", null)
    .not("maestro_broker_id", "is", null)
    .limit(limit);
  if (body?.user_id) q = q.eq("user_id", String(body.user_id));

  const { data: profiles } = await q;
  const rows = (profiles ?? []) as any[];

  // Dernière synchro réussie par courtier — sert au délai de rafraîchissement.
  const lastOk = new Map<string, string>();
  if (!force && staleMinutes > 0 && rows.length) {
    const since = new Date(Date.now() - staleMinutes * 60_000).toISOString();
    const { data: recent } = await admin
      .from("planipret_task_sync_runs")
      .select("user_id, finished_at")
      .eq("ok", true)
      .gte("finished_at", since)
      .in("user_id", rows.map((p) => String(p.user_id)));
    for (const r of (recent ?? []) as any[]) {
      const key = String(r.user_id);
      const prev = lastOk.get(key);
      if (!prev || String(r.finished_at) > prev) lastOk.set(key, String(r.finished_at));
    }
  }

  const results: any[] = [];
  let synced = 0;
  let totalTasks = 0;
  let skipped = 0;

  for (const p of rows) {
    const userId = String(p.user_id);
    const broker = p.maestro_broker_id != null ? String(p.maestro_broker_id) : null;

    if (lastOk.has(userId)) {
      skipped++;
      results.push({ broker, name: p.full_name, ok: true, skipped: true, last_sync_at: lastOk.get(userId) });
      continue;
    }

    const startedAt = new Date();
    let entry: any;
    try {
      const res = await fetch(`${baseUrl}/functions/v1/planipret-task-api`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "list", user_id: userId, source: "tasks_sweeper", limit: 200 }),
      });
      const j: any = await res.json().catch(() => ({}));
      const count = Number(j?.counts?.all ?? 0);
      if (j?.source === "api" && count > 0) { synced++; totalTasks += count; }
      entry = {
        broker, name: p.full_name,
        ok: j?.success === true, source: j?.source ?? null, tasks: count,
        status: res.status, error: j?.error ?? null,
      };
    } catch (e) {
      entry = { broker, name: p.full_name, ok: false, source: null, tasks: 0, status: null, error: String(e) };
    }
    const finishedAt = new Date();
    results.push(entry);

    // Historique par courtier — jamais bloquant pour la synchro suivante.
    await admin.from("planipret_task_sync_runs").insert({
      user_id: userId,
      maestro_broker_id: broker,
      source: String(body?.source ?? "sweeper"),
      ok: entry.ok === true,
      tasks_count: Number(entry.tasks ?? 0),
      result_source: entry.source,
      http_status: entry.status ?? null,
      error: entry.error ? String(entry.error).slice(0, 500) : null,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    }).then(() => {}, () => {});
  }

  return jsonResponse({
    success: true,
    brokers: rows.length,
    brokers_with_tasks: synced,
    brokers_skipped_fresh: skipped,
    stale_minutes: force ? 0 : staleMinutes,
    tasks: totalTasks,
    results: results.slice(0, 300),
  }, 200);
});
