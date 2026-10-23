// Admin-only: pushes every active Maestro-linked broker to the widget sync webhook.
// Body: { limit?: number, user_id?: string } — user_id runs a single test push.
import { corsHeaders, jsonResponse, requirePlanipretAdmin } from "../_shared/ns-broker.ts";
import { syncBrokerToWidget } from "../_shared/maestro-widget-sync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requirePlanipretAdmin(req);
    if ("error" in auth) return auth.error;
    const { admin } = auth;
    const body = await req.json().catch(() => ({}));
    let q = admin.from("planipret_profiles").select("user_id, extension, ns_extension, maestro_broker_id, email, status");
    if (typeof body?.user_id === "string") q = q.eq("user_id", body.user_id);
    const { data, error } = await q;
    if (error) return jsonResponse({ success: false, error: "profiles_read_failed" }, 200);
    const rows = (data ?? []).filter((r: any) => {
      const ext = String(r.ns_extension ?? r.extension ?? "").trim();
      return ext && !/^\d{7,}$/.test(ext) && !/@lemtel\.com$/i.test(String(r.email ?? ""))
        && !["disabled", "suspended", "deleted", "inactive"].includes(String(r.status ?? "").toLowerCase());
    }).slice(0, Math.min(Number(body?.limit) || 500, 500));

    let sent = 0, failed = 0, notLinked = 0;
    const errors: Record<string, number> = {};
    const details: unknown[] = [];
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      const results = await Promise.all(batch.map((r: any) => syncBrokerToWidget(admin, {
        userId: r.user_id, crmId: r.maestro_broker_id ?? null,
        extension: String(r.ns_extension ?? r.extension), force: true,
      }).then((res) => (r.maestro_broker_id ? res : { ok: false, status: 0, skipped: "not_linked" as const }))));
      for (const res of results) {
        if (res.skipped === "not_linked") notLinked++;
        else if (res.ok) sent++;
        else { failed++; const k = res.error_code ?? res.skipped ?? "unknown"; errors[k] = (errors[k] ?? 0) + 1; if (body?.user_id && (res as any).detail !== undefined) details.push({ status: res.status, provider_response: (res as any).detail }); }
      }
    }
    return jsonResponse({ success: failed === 0, total: rows.length, sent, failed, not_linked: notLinked, errors, ...(body?.user_id ? { details } : {}) });
  } catch {
    return jsonResponse({ success: false, error: "internal" }, 200);
  }
});
