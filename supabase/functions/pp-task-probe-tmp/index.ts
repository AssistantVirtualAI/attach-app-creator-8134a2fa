// TEMPORARY diagnostic: probes Maestro task listing routes for one broker.
// Returns HTTP statuses and row counts only — never tokens or task content.
import { corsHeaders, jsonResponse, supaAdmin } from "../_shared/ns-broker.ts";
import { getUserMaestroAccessToken } from "../_shared/maestro-oauth.ts";

const API_BASE = (Deno.env.get("PLANIPRET_API_BASE_URL") ?? "https://client.planipret.com").replace(/\/$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const email = String((body as any)?.email ?? "");
  if (!email) return jsonResponse({ error: "email_required" }, 400);

  const admin = supaAdmin();
  const { data: profile } = await admin.from("planipret_profiles")
    .select("id, role, maestro_broker_id, maestro_telecom_user_id, maestro_connected")
    .eq("email", email).maybeSingle();
  if (!profile) return jsonResponse({ error: "profile_not_found" }, 404);

  let token: string | null = null;
  let tokenError: string | null = null;
  try { token = await getUserMaestroAccessToken(admin, (profile as any).id); }
  catch (e) { tokenError = String((e as Error).message); }
  if (!token) return jsonResponse({ error: "no_maestro_token", tokenError, profile }, 200);

  const xid = String((profile as any).maestro_broker_id ?? "");
  const tid = String((profile as any).maestro_telecom_user_id ?? xid);
  const paths = [
    `/telecom/api/v1/users/${tid}/tasks?limit=200`,
    `/api/main/tasks?xid=${xid}&type=user&limit=200`,
    `/api/main/tasks?users_id=${xid}&limit=200`,
    `/api/main/tasks/list?users_id=${xid}`,
    `/api/main/users/${xid}/tasks`,
  ];
  const results: unknown[] = [];
  for (const p of paths) {
    try {
      const r = await fetch(`${API_BASE}${p}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await r.text();
      let count: number | null = null;
      try {
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : (j?.data ?? j?.tasks ?? j?.items ?? null);
        count = Array.isArray(arr) ? arr.length : null;
      } catch { /* not json */ }
      results.push({ path: p, status: r.status, count, sample: text.slice(0, 300) });
    } catch (e) {
      results.push({ path: p, status: 599, error: String((e as Error).message) });
    }
  }
  return jsonResponse({ ok: true, xid, tid, role: (profile as any).role, results });
});
