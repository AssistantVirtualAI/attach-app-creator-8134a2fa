/**
 * pp-originate-probe — sonde temporaire de diagnostic pour l'origination NS.
 * Lecture seule par défaut (GET user / devices / registrations / calls).
 * Gate par jeton statique passé en en-tête x-probe-token.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { nsFetch } from "../_shared/planipret-ns.ts";

const TOKEN = "pp-probe-9f2c1ad4";

async function q(path: string, init?: RequestInit) {
  try {
    const r = await nsFetch(path, init ?? { method: "GET" }, { functionName: "pp-originate-probe" });
    const t = await r.text();
    let b: unknown = t;
    try { b = t ? JSON.parse(t) : null; } catch { /* raw */ }
    return { path, method: init?.method ?? "GET", status: r.status, body: b };
  } catch (e) {
    return { path, method: init?.method ?? "GET", status: 0, body: String((e as Error)?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.headers.get("x-probe-token") !== TOKEN) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const body = await req.json().catch(() => ({} as any));
  const domain = String(body.domain ?? "planipret.ca");
  const ext = String(body.ext ?? "113");
  const d = encodeURIComponent(domain);
  const u = encodeURIComponent(ext);

  const out: unknown[] = [];
  out.push(await q(`/domains/${d}/users/${u}`));
  out.push(await q(`/domains/${d}/users/${u}/devices`));
  out.push(await q(`/domains/${d}/users/${u}/registrations`));
  out.push(await q(`/domains/${d}/users/${u}/calls`));

  if (body.originate) {
    const term = String(body.term ?? "");
    const orig = String(body.orig ?? `${ext}@${domain}`);
    out.push(await q(`/domains/${d}/users/${u}/calls`, {
      method: "POST",
      body: JSON.stringify({
        "call-id": crypto.randomUUID(),
        "call-orig-user": orig,
        "call-term-user": term,
        "auto-answer-enabled": "no",
        synchronous: "yes",
      }),
    }));
  }

  return new Response(JSON.stringify({ domain, ext, results: out }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
