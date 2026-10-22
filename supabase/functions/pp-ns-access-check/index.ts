// pp-ns-access-check — a Planiprêt member may use the portal / mobile app only
// while they exist as an active broker in NetSapiens. Read-only; no NS writes.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { nsFetch } from "../_shared/planipret-ns.ts";
import { decideNsAccess } from "./decide.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "missing_auth" }, 401);
    const { data: u, error } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }).auth.getUser();
    if (error || !u?.user) return json({ error: "invalid_session" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: sup } = await admin.rpc("is_super_admin", { _user_id: u.user.id });
    const { data: p } = await admin.from("planipret_profiles")
      .select("extension, ns_extension, ns_domain").eq("user_id", u.user.id).maybeSingle();
    const ext = String((p as any)?.ns_extension || (p as any)?.extension || "").trim();
    const domain = String((p as any)?.ns_domain || "planipret.ca").trim();

    let nsStatus: number | null = null;
    let nsUser: Record<string, unknown> | null = null;
    if (sup !== true && ext) {
      try {
        const r = await nsFetch(`/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(ext)}`, {}, { functionName: "pp-ns-access-check" });
        nsStatus = r.status;
        const body = await r.json().catch(() => null);
        nsUser = Array.isArray(body) ? (body[0] ?? null) : body;
      } catch { nsStatus = null; }
    }
    const d = decideNsAccess({ isSuperAdmin: sup === true, extension: ext, nsStatus, nsUser });
    return json({ allowed: d.allowed, reason: d.reason });
  } catch (e) {
    console.error("[pp-ns-access-check] error", e instanceof Error ? e.name : "Error");
    return json({ allowed: true, reason: "ns_unavailable" });
  }
});
