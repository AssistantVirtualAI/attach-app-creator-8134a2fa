import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMaestroTelecomConfig, isMaestroTelecomConfigured, maestroTelecomFetch } from "../_shared/maestro-telecom.ts";
import { getMaestroOAuthEnv, getUserMaestroAccessToken, fetchMaestroUserProfile } from "../_shared/maestro-oauth.ts";
import { resolveRevenue, auditSummary, isStrictMappingEnabled } from "../_shared/maestro-commission-map.ts";

/**
 * Broker commissions sourced from Maestro.
 *
 * Fetches the caller's funded deals/mortgages from Maestro and aggregates
 * them into the same `CommissionRow` shape the commission dashboard already
 * renders (sections: kpi, lender, quarter, product_mix, term_mix, matrix).
 * The frontend can then display Maestro data without any schema change.
 */

type Row = {
  id: string;
  broker_name: string;
  broker_user_id: string | null;
  fiscal_year: number;
  section: string;
  dimension: string | null;
  sub_dimension: string | null;
  rank: number | null;
  cy_volume: number;
  py_volume: number;
  cy_deals: number;
  py_deals: number;
  cy_commission: number;
  py_commission: number;
  extra: Record<string, unknown>;
  source_file: string | null;
  entry_source: string;
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const pick = (o: any, keys: string[]): any => {
  for (const k of keys) {
    if (o && o[k] != null && o[k] !== "") return o[k];
  }
  return null;
};

const COMMISSION_FALLBACK_FIELDS = ["commission", "commission_amount", "total_commission", "broker_commission", "revenue", "Case amount"];

function normalizeDeal(d: any) {
  const dateRaw = pick(d, ["funding_date", "funded_at", "closing_date", "close_date", "completion_date", "date", "created_at"]);
  const date = dateRaw ? new Date(String(dateRaw)) : null;
  const amount = num(pick(d, ["mortgage_amount", "loan_amount", "amount", "volume", "financing_amount", "principal"]));
  // Provenance: the commission is the RAW value of the exact Maestro field selected
  // by the (record type + stage) mapping. No recalculation is ever applied.
  const provenance = resolveRevenue(d, COMMISSION_FALLBACK_FIELDS);
  const commission = num(provenance.revenue_raw);
  const lender = String(pick(d, ["lender", "lender_name", "institution", "bank", "financial_institution"]) ?? "—").trim() || "—";
  const product = String(pick(d, ["product_type", "product", "rate_type", "mortgage_type", "type"]) ?? "—").trim() || "—";
  const termRaw = pick(d, ["term", "term_years", "term_length", "duration"]);
  const term = termRaw == null ? "" : String(termRaw).trim();
  const status = String(pick(d, ["status", "state", "stage"]) ?? "").toLowerCase();
  return { date, amount, commission, lender, product, term, status, provenance, raw: d };
}


function fiscalYearOf(d: Date) { return d.getUTCFullYear(); }
function quarterOf(d: Date) { return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`; }

function aggregate(deals: ReturnType<typeof normalizeDeal>[], brokerName: string, brokerUserId: string | null, cy: number) {
  const py = cy - 1;
  const rows: Row[] = [];
  let seq = 0;
  const mk = (section: string, dimension: string | null, sub: string | null, extra: Record<string, unknown> = {}): Row => ({
    id: `maestro-${section}-${dimension ?? ""}-${sub ?? ""}-${seq++}`,
    broker_name: brokerName,
    broker_user_id: brokerUserId,
    fiscal_year: cy,
    section,
    dimension,
    sub_dimension: sub,
    rank: null,
    cy_volume: 0, py_volume: 0, cy_deals: 0, py_deals: 0, cy_commission: 0, py_commission: 0,
    extra,
    source_file: "maestro",
    entry_source: "maestro",
  });

  const bucket = new Map<string, Row>();
  const add = (section: string, dimension: string | null, sub: string | null, d: ReturnType<typeof normalizeDeal>, year: number) => {
    const key = `${section}|${dimension}|${sub}`;
    let r = bucket.get(key);
    if (!r) { r = mk(section, dimension, sub); bucket.set(key, r); rows.push(r); }
    if (year === cy) { r.cy_volume += d.amount; r.cy_deals += 1; r.cy_commission += d.commission; }
    else if (year === py) { r.py_volume += d.amount; r.py_deals += 1; r.py_commission += d.commission; }
  };

  let cyVol = 0, pyVol = 0, cyCnt = 0, pyCnt = 0, cyCom = 0, pyCom = 0;
  for (const d of deals) {
    if (!d.date || Number.isNaN(d.date.getTime())) continue;
    const y = fiscalYearOf(d.date);
    if (y !== cy && y !== py) continue;
    if (y === cy) { cyVol += d.amount; cyCnt += 1; cyCom += d.commission; }
    else { pyVol += d.amount; pyCnt += 1; pyCom += d.commission; }
    add("lender", d.lender, null, d, y);
    add("quarter", quarterOf(d.date), null, d, y);
    add("month", String(d.date.getUTCMonth() + 1).padStart(2, "0"), null, d, y);
    add("product_mix", d.product, null, d, y);
    add("term_mix", d.term || "Other", null, d, y);
    add("matrix", d.product, d.term || "Other", d, y);
    if (d.status) add("pipeline", d.status, null, d, y);

  }

  const yoy = (c: number, p: number) => (p ? ((c - p) / p) * 100 : null);
  const kpi = (dim: string, label: string, c: number, p: number) => {
    const r = mk("kpi", dim, null, { label, cy: c, py: p, yoy: yoy(c, p) });
    rows.push(r);
  };
  kpi("volume", "Volume", cyVol, pyVol);
  kpi("deals", "Dossiers", cyCnt, pyCnt);
  kpi("commission", "Commissions", cyCom, pyCom);
  kpi("avg_deal", "Prêt moyen", cyCnt ? cyVol / cyCnt : 0, pyCnt ? pyVol / pyCnt : 0);
  kpi("bps", "BPS", cyVol ? (cyCom / cyVol) * 10000 : 0, pyVol ? (pyCom / pyVol) * 10000 : 0);

  // Rank lenders by current-year volume for a stable display order.
  rows.filter((r) => r.section === "lender")
    .sort((a, b) => b.cy_volume - a.cy_volume)
    .forEach((r, i) => { r.rank = i + 1; });

  return rows;
}

/** Maestro has no single documented commissions endpoint: probe the known shapes. */
const DEAL_PATHS = (uid: string) => [
  `/users/${uid}/deals`,
  `/users/${uid}/mortgages`,
  `/users/${uid}/commissions`,
  `/users/${uid}/files`,
  `/users/${uid}/applications`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const fiscalYear = Number(body?.fiscal_year) || new Date().getUTCFullYear();

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return j({ success: false, rows: [], error: "unauthorized", code: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const callerId = u?.user?.id ?? null;
    if (!callerId) return j({ success: false, rows: [], error: "unauthorized", code: "unauthorized" }, 401);

    const { data: prof } = await admin
      .from("planipret_profiles")
      .select("id, user_id, full_name, email, maestro_broker_id, maestro_connected")
      .or(`user_id.eq.${callerId},id.eq.${callerId}`)
      .limit(1)
      .maybeSingle();
    if (!prof) return j({ success: false, rows: [], error: "profil introuvable", code: "no_profile" });

    let telecomUserId = prof.maestro_broker_id ? String(prof.maestro_broker_id).trim() : null;
    if (!telecomUserId || !/^\d+$/.test(telecomUserId)) {
      try {
        const tok = await getUserMaestroAccessToken(admin, callerId);
        if (tok) {
          const me = await fetchMaestroUserProfile(getMaestroOAuthEnv(), tok);
          const mid = (me as any)?.id ?? (me as any)?.user?.id ?? (me as any)?.user_id ?? null;
          if (mid && /^\d+$/.test(String(mid))) {
            telecomUserId = String(mid);
            await admin.from("planipret_profiles")
              .update({ maestro_broker_id: telecomUserId, maestro_connected: true })
              .eq("id", prof.id);
          }
        }
      } catch { /* not connected */ }
    }
    if (!telecomUserId || !/^\d+$/.test(telecomUserId)) {
      return j({
        success: false,
        rows: [],
        code: "maestro_not_connected",
        error: "Connectez votre compte Maestro dans Réglages → Maestro pour voir vos commissions.",
      });
    }

    const tCfg = await getMaestroTelecomConfig(admin);
    if (!isMaestroTelecomConfigured(tCfg)) {
      return j({ success: false, rows: [], code: "not_configured", error: "Intégration Maestro non configurée." });
    }

    let raw: any[] = [];
    let usedPath: string | null = null;
    const attempts: Array<{ path: string; status: number | null }> = [];
    for (const path of DEAL_PATHS(telecomUserId)) {
      const r = await maestroTelecomFetch(tCfg, path, { method: "GET", timeoutMs: 12000 });
      attempts.push({ path, status: r.status ?? null });
      if (!r.ok) continue;
      const d: any = r.data;
      const list = Array.isArray(d) ? d : (d?.deals ?? d?.mortgages ?? d?.commissions ?? d?.files ?? d?.applications ?? d?.data ?? d?.results ?? []);
      if (Array.isArray(list) && list.length) { raw = list; usedPath = path; break; }
      if (Array.isArray(list) && usedPath == null) { usedPath = path; }
    }

    if (!usedPath) {
      return j({
        success: false,
        rows: [],
        code: "no_endpoint",
        error: "Aucun endpoint de dossiers Maestro n'a répondu pour ce courtier.",
        attempts,
      });
    }

    const deals = raw.map(normalizeDeal);
    const brokerName = String(prof.full_name ?? prof.email ?? "Courtier");
    const rows = aggregate(deals, brokerName, prof.user_id ?? prof.id ?? null, fiscalYear);

    return j({
      success: true,
      rows,
      source: "maestro",
      maestro_user_id: telecomUserId,
      path: usedPath,
      deal_count: deals.length,
      fiscal_year: fiscalYear,
    });
  } catch (e: any) {
    console.error("pp-maestro-commissions error", e);
    return j({ success: false, rows: [], error: e?.message ?? "server_error" }, 500);
  }
});
