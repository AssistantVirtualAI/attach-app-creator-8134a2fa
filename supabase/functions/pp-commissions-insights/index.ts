import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { claudeText } from "../_shared/anthropic.ts";
import { insightsCacheKey, readInsightsCache, writeInsightsCache } from "../_shared/insights-cache.ts";
import { commissionDataVersion } from "../_shared/commission-version.ts";
import { COMMISSION_INSIGHTS_TTL_MS, commissionInsightsCacheScope } from "../_shared/commission-insights-cache.ts";

/**
 * AI insights for the commissions dashboard.
 *
 * Input: pre-aggregated commission metrics (no client PII).
 * Output: { summary, insights: [{ category, title, finding, action, severity }] }
 */

const SYSTEM = `Tu es un analyste financier senior spécialisé en courtage hypothécaire au Québec.
On te fournit les données de commissions telles que renvoyées par l'endpoint Maestro
(agrégats + lignes de dossiers) pour un courtier ou pour l'agence entière : volume, dossiers,
commissions, BPS, répartition par prêteur, par produit, par terme, par trimestre et par mois,
année courante (CY) vs année précédente (PY).

Tu produis une analyse courte, concrète et actionnable.

SOURCE ET PROVENANCE (règles strictes):
- Les montants proviennent de Maestro. Tu ne recalcules jamais un montant : tu cites la valeur fournie.
- Le champ "dataSource" indique la date de synchronisation et si les données sont en cache (stale:true).
  Si stale = true, précise dans "summary" que l'analyse porte sur la dernière synchronisation connue.
- "unmappedRows" = lignes non rattachées à une règle de revenu : signale-les, ne les devine pas.
- Portée: si scope = "admin", analyse l'ensemble des courtiers et compare-les entre eux (champ "brokers").
  Si scope = "broker", l'analyse porte uniquement sur les dossiers de ce courtier ("agent"), jamais sur les autres.
- Respecte les filtres actifs ("lenderFilter", "period", "window") : n'analyse que la tranche visible.

RÈGLES:
- Réponds UNIQUEMENT avec du JSON valide, sans texte autour, sans bloc de code.
- Structure exacte:
{"summary":"...","insights":[{"category":"growth|lenders|products|risk|seasonality","title":"...","finding":"...","action":"...","severity":"positive|neutral|warning","metric":"..."}]}
- 3 à 5 insights maximum, chacun basé sur les chiffres fournis (cite des montants ou %).
- "summary": 1 à 2 phrases, ton exécutif.
- "title": max 6 mots. "finding": max 220 caractères. "action": recommandation concrète, max 180 caractères.
- "metric": une valeur courte à afficher en badge (ex: "+18,4 %", "142 BPS", "3 prêteurs = 71 %").
- Écris dans la langue demandée par l'utilisateur (fr ou en).
- N'invente aucune donnée absente. Si les données sont trop minces, dis-le dans summary et donne moins d'insights.`;

function extractJson(text: string): any | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return j({ success: false, error: "unauthorized" }, 401);
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    const viewerId = userErr ? null : userRes?.user?.id;
    if (!viewerId) return j({ success: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === "en" ? "en" : "fr";
    const metrics = body?.metrics;
    const force = body?.force === true;
    if (!metrics || typeof metrics !== "object") return j({ success: false, error: "metrics manquants" }, 400);
    const scope = body?.scope === "admin" ? "admin" : "broker";

    const userText = [
      `Langue de réponse: ${lang}`,
      `Portée: ${scope === "admin" ? "agence (tous les courtiers)" : "courtier individuel"}`,
      `Source des données: ${body?.source ?? "maestro"} (synchronisation Maestro)`,
      "Métriques (JSON):",
      JSON.stringify(metrics).slice(0, 18000),
    ].join("\n");

    // The server-side hash partitions the cache by authenticated viewer without
    // storing the identity. Data values are intentionally omitted from the key:
    // selected period/filter + manual refresh govern the once-daily AI cadence.
    const viewerKey = await insightsCacheKey("commission-viewer", viewerId);
    const cacheScope = commissionInsightsCacheScope({
      userId: viewerKey,
      lang,
      scope,
      source: body?.source,
      year: metrics.year,
      period: metrics.period,
      granularity: metrics.granularity,
      window: metrics.window,
      agent: metrics.agent,
      lenderFilter: metrics.lenderFilter,
      dataVersion: await commissionDataVersion(admin),
    });
    const cacheKey = await insightsCacheKey("commissions-insights", cacheScope);
    const cached = force ? null : await readInsightsCache(cacheKey, COMMISSION_INSIGHTS_TTL_MS);
    if (cached) return j({ ...(cached as object), cached: true });

    // Single-flight: concurrent openings of the same view share one AI call.
    const lockKey = `lock:${cacheKey}`;
    const { data: lock } = await admin.from("ai_insights_cache").select("created_at").eq("cache_key", lockKey).maybeSingle();
    if (lock && Date.now() - new Date((lock as any).created_at).getTime() < 90_000) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const done = await readInsightsCache(cacheKey, COMMISSION_INSIGHTS_TTL_MS);
        if (done) return j({ ...(done as object), cached: true });
      }
      return j({ success: false, error: "analyse_en_cours" }, 409);
    }
    await admin.from("ai_insights_cache").upsert({ cache_key: lockKey, payload: {}, created_at: new Date().toISOString() });

    const text = await claudeText(SYSTEM, userText, {
      cacheTtl: "1h",
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1400,
      temperature: 0.3,
      label: "commissions-insights",
    });
    if (!text) { await admin.from("ai_insights_cache").delete().eq("cache_key", lockKey); return j({ success: false, error: "AI indisponible" }, 502); }

    const parsed = extractJson(text);
    if (!parsed) { await admin.from("ai_insights_cache").delete().eq("cache_key", lockKey); return j({ success: false, error: "Réponse IA illisible" }, 502); }

    const insights = Array.isArray(parsed.insights) ? parsed.insights.slice(0, 5).map((i: any) => ({
      category: ["growth", "lenders", "products", "risk", "seasonality"].includes(String(i?.category)) ? String(i.category) : "growth",
      title: String(i?.title ?? "").slice(0, 80),
      finding: String(i?.finding ?? "").slice(0, 400),
      action: String(i?.action ?? "").slice(0, 300),
      severity: ["positive", "neutral", "warning"].includes(String(i?.severity)) ? String(i.severity) : "neutral",
      metric: i?.metric == null ? null : String(i.metric).slice(0, 40),
    })) : [];

    const result = { success: true, summary: String(parsed.summary ?? "").slice(0, 600), insights };
    await writeInsightsCache(cacheKey, result);
    await admin.from("ai_insights_cache").delete().eq("cache_key", lockKey);
    return j(result);
  } catch (e: any) {
    console.error("pp-commissions-insights error", e);
    return j({ success: false, error: e?.message ?? "server_error" }, 500);
  }
});
