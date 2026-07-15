// Maestro Telecom REST API proxy.
// Keeps the Maestro Bearer token server-side and resolves the current
// authenticated user's Maestro broker id, so the mobile app can call
// endpoints like /users/{id}/calls without ever seeing the API key
// or the numeric Maestro user id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BASE = Deno.env.get("MAESTRO_TELECOM_BASE_URL") || "";
const TOKEN = Deno.env.get("MAESTRO_TELECOM_API_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!BASE || !TOKEN) return json({ error: "maestro_not_configured" }, 500);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as any));
    let { path, method = "GET", body: reqBody, query } = body as {
      path?: string; method?: string; body?: unknown; query?: Record<string, string>;
    };
    if (!path || typeof path !== "string") return json({ error: "missing_path" }, 400);

    // Resolve {me} → current broker's Maestro id
    if (path.includes("{me}")) {
      const { data: prof } = await sb
        .from("planipret_profiles")
        .select("maestro_broker_id")
        .eq("user_id", u.user.id)
        .maybeSingle();
      const meId = prof?.maestro_broker_id;
      if (!meId) return json({ error: "no_maestro_broker_id" }, 400);
      path = path.replaceAll("{me}", encodeURIComponent(String(meId)));
    }

    // Build URL with ?machine=1 + user-supplied query
    const url = new URL(BASE.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`));
    url.searchParams.set("machine", "1");
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const upstream = await fetch(url.toString(), {
      method,
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: reqBody !== undefined && method !== "GET" ? JSON.stringify(reqBody) : undefined,
    });

    const text = await upstream.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!upstream.ok) {
      console.error("[maestro-telecom]", method, url.pathname, upstream.status, text?.slice(0, 500));
      return json({ error: "maestro_error", status: upstream.status, details: data }, 200);
    }
    return json({ ok: true, data });
  } catch (e) {
    console.error("[maestro-telecom]", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
