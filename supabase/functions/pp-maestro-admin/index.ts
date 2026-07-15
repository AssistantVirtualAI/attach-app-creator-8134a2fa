// pp-maestro-admin — admin-only Maestro Telecom oversight.
//
// POST body { action, ...params }
//
// Actions:
//   status     → { configured, base_url, ping_ok, ping_status, ping_ms, stats24h }
//   sync-log   → { entries: [...], total } (params: limit=50, since_hours=24, only_failures=false)
//   stats      → aggregate success rate/actions over N hours (params: hours=24)

import { corsHeaders, jsonResponse } from "../_shared/planipret-ns.ts";
import { requirePlanipretAdmin } from "../_shared/ns-broker.ts";
import {
  getMaestroTelecomConfig,
  isMaestroTelecomConfigured,
  pingMaestroTelecom,
} from "../_shared/maestro-telecom.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const guard = await requirePlanipretAdmin(req);
  if ("error" in guard) return guard.error;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action ?? "status");

  try {
    if (action === "status") {
      const cfg = await getMaestroTelecomConfig(admin);
      const configured = isMaestroTelecomConfigured(cfg);
      const meMaestroId = (guard as any).profile?.maestro_broker_id ?? null;
      const ping = configured
        ? await pingMaestroTelecom(admin, meMaestroId)
        : { configured: false, base_url: cfg.url || "", ok: false, status: 0, error: "not_configured" };

      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: recent } = await admin
        .from("planipret_maestro_sync_log")
        .select("success, action, response_status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      const rows = recent ?? [];
      const total = rows.length;
      const failed = rows.filter((r: any) => !r.success).length;
      const lastCall = rows.find((r: any) => String(r.action ?? "").startsWith("call."));
      const lastSms = rows.find((r: any) => String(r.action ?? "").startsWith("sms."));

      return jsonResponse({
        ok: true,
        configured,
        base_url: cfg.url,
        ping,
        stats24h: {
          total,
          failed,
          success_rate: total ? Math.round(((total - failed) / total) * 100) : null,
        },
        last_call_mirror: lastCall ?? null,
        last_sms_mirror: lastSms ?? null,
      });
    }

    if (action === "sync-log") {
      const limit = Math.min(500, Math.max(1, Number(body.limit ?? 100)));
      const since = new Date(Date.now() - Math.max(1, Number(body.since_hours ?? 72)) * 3600_000).toISOString();
      let q = admin
        .from("planipret_maestro_sync_log")
        .select("id, created_at, user_id, action, maestro_endpoint, response_status, duration_ms, success, request_body, response_body")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (body.only_failures) q = q.eq("success", false);
      const { data, error } = await q;
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true, entries: data ?? [], count: data?.length ?? 0 });
    }

    if (action === "stats") {
      const hours = Math.min(720, Math.max(1, Number(body.hours ?? 24)));
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const { data } = await admin
        .from("planipret_maestro_sync_log")
        .select("action, success, response_status, duration_ms, created_at")
        .gte("created_at", since)
        .limit(5000);
      const rows = data ?? [];
      const byAction: Record<string, { total: number; failed: number; avg_ms: number }> = {};
      for (const r of rows) {
        const k = String((r as any).action ?? "unknown");
        const b = byAction[k] ?? { total: 0, failed: 0, avg_ms: 0 };
        b.total += 1;
        if (!(r as any).success) b.failed += 1;
        b.avg_ms += Number((r as any).duration_ms ?? 0);
        byAction[k] = b;
      }
      for (const k of Object.keys(byAction)) {
        byAction[k].avg_ms = byAction[k].total ? Math.round(byAction[k].avg_ms / byAction[k].total) : 0;
      }
      return jsonResponse({ ok: true, hours, by_action: byAction, total: rows.length });
    }

    return jsonResponse({ error: `unsupported action: ${action}` }, 400);
  } catch (e) {
    console.error("[pp-maestro-admin]", e);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
