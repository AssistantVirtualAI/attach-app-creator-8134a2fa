import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  type RegisterRow,
  type Window,
  metrics,
  periodVolume,
  periodDeals,
  periodCommission,
  volumeTranches,
  dealContracts,
  monthWindow,
  ytdWindow,
  quarterWindow,
  seasonWindow,
  yearWindow,
  weekWindow,
  isoWeeksInYear,
  resolveWindow,
  type Granularity,
  yoy,
} from "../_shared/commission-engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const uniq = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean)));

function breakdown(
  rows: RegisterRow[],
  w: Window,
  wPy: Window,
  field: "institution" | "mortgage_type" | "term",
) {
  const keys = uniq([
    ...volumeTranches(rows, w).map((r) => r[field]),
    ...volumeTranches(rows, wPy).map((r) => r[field]),
    ...dealContracts(rows, w).map((r) => r[field]),
  ]);
  const totalVolume = periodVolume(rows, w);
  const list = keys.map((k) => {
    const c = { [field]: k } as Record<string, string>;
    const cyVolume = periodVolume(rows, w, c);
    const cyDeals = periodDeals(rows, w, c);
    const cyCommission = rows
      .filter((r) => r.date_trans && r.date_trans >= w.start && r.date_trans <= w.end && (r[field] ?? "") === k)
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const pyVolume = periodVolume(rows, wPy, c);
    const pyDeals = periodDeals(rows, wPy, c);
    const pyCommission = rows
      .filter((r) => r.date_trans && r.date_trans >= wPy.start && r.date_trans <= wPy.end && (r[field] ?? "") === k)
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return {
      key: k,
      cyVolume,
      cyDeals,
      cyCommission,
      pyVolume,
      pyDeals,
      pyCommission,
      cyBps: cyVolume ? (cyCommission / cyVolume) * 10000 : 0,
      pyBps: pyVolume ? (pyCommission / pyVolume) * 10000 : 0,
      sharePct: totalVolume ? cyVolume / totalVolume : 0,
      volumeYoy: yoy(cyVolume, pyVolume),
      commissionYoy: yoy(cyCommission, pyCommission),
    };
  });
  list.sort((a, b) => b.cyVolume - a.cyVolume);
  return list.map((x, i) => ({ rank: i + 1, ...x }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const year = Number(body?.year) || new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number(body?.month) || 12));
    const scope: "self" | "all" = body?.scope === "all" ? "all" : "self";
    const granularity = (["week", "month", "quarter", "year", "ytd"].includes(body?.granularity)
      ? body.granularity
      : "ytd") as Granularity;
    const periodIndex = Number(body?.periodIndex) || (granularity === "ytd" ? month : granularity === "quarter" ? Math.ceil(month / 3) : granularity === "month" ? month : 1);
    const agent: string | null = typeof body?.agent === "string" && body.agent.trim() ? body.agent.trim() : null;

    const { data: isAdminData } = await admin.rpc("is_planipret_admin", { _user_id: user.id });
    const isAdmin = Boolean(isAdminData);

    // Pull the years we need: PY, CY, and the season overlap year.
    const years = [year - 1, year, year + 1];
    const { data: allRowsRaw, error } = await admin
      .from("planipret_commission_register")
      .select(
        "number,loan_amt,institution,amount,mortgage_type,term,agent_name,date_trans,commission_type,source_row,broker_user_id,first_name,last_name,maestro_broker_id,agent_key",
      )
      .in("fiscal_year", years)
      .order("source_row", { ascending: true })
      .limit(200000);
    if (error) return json({ error: error.message }, 500);

    const allRows = (allRowsRaw ?? []) as RegisterRow[];

    const { data: prof } = await admin
      .from("planipret_profiles")
      .select("full_name,first_name,last_name,maestro_broker_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const myName: string | null = (prof as any)?.full_name ?? null;
    const myMaestroId: string | null = (prof as any)?.maestro_broker_id ?? null;

    const scopedAll =
      scope === "all" && isAdmin
        ? allRows
        : allRows.filter(
            (r) =>
              r.broker_user_id === user.id ||
              (!r.broker_user_id && myMaestroId && (r as any).maestro_broker_id === myMaestroId) ||
              (!r.broker_user_id && myName && (r.agent_name ?? "").trim().toLowerCase() === myName.trim().toLowerCase()),
          );

    // Optional agent filter (admin global view)
    const mine = agent
      ? scopedAll.filter((r) => (r.agent_name ?? "").trim().toLowerCase() === agent.toLowerCase())
      : scopedAll;

    const resolved = resolveWindow(granularity, year, periodIndex);
    const cyYtd = resolved.window;
    const pyYtd = resolved.priorWindow;
    const cyMonth = monthWindow(year, month);
    const pyMonth = monthWindow(year - 1, month);

    const kpi = {
      ytd: metrics(mine, cyYtd),
      ytdPy: metrics(mine, pyYtd),
      month: metrics(mine, cyMonth),
      monthPy: metrics(mine, pyMonth),
      activeLenders: uniq(volumeTranches(mine, cyYtd).map((r) => r.institution)).length,
      activeBrokers: uniq(volumeTranches(scopedAll, cyYtd).map((r) => r.agent_name)).length,
    };

    // Trend series adapted to the granularity (weeks when granularity=week, otherwise months)
    const series =
      granularity === "week"
        ? Array.from({ length: isoWeeksInYear(year) }, (_, i) => {
            const w = i + 1;
            const wc = weekWindow(year, w);
            const wp = weekWindow(year - 1, Math.min(isoWeeksInYear(year - 1), w));
            const c = metrics(mine, wc);
            const p = metrics(mine, wp);
            return {
              index: w,
              label: `S${w}`,
              cyVolume: c.volume, cyDeals: c.deals, cyCommission: c.commission,
              pyVolume: p.volume, pyDeals: p.deals, pyCommission: p.commission,
              avgDeal: c.avgDeal, bps: c.bps,
              volumeYoy: yoy(c.volume, p.volume), commissionYoy: yoy(c.commission, p.commission),
            };
          })
        : null;

    // Per-broker leaderboard on the selected window (admin global view)
    const brokerKeys = uniq([
      ...volumeTranches(scopedAll, cyYtd).map((r) => r.agent_name),
      ...volumeTranches(scopedAll, pyYtd).map((r) => r.agent_name),
    ]);
    const brokerTotalVolume = periodVolume(scopedAll, cyYtd);
    const brokers = brokerKeys
      .map((name) => {
        const c = metrics(scopedAll, cyYtd, { broker: name });
        const p = metrics(scopedAll, pyYtd, { broker: name });
        const idRow = scopedAll.find((x) => x.agent_name === name) as any;
        return {
          broker: name,
          firstName: idRow?.first_name ?? null,
          lastName: idRow?.last_name ?? null,
          maestroBrokerId: idRow?.maestro_broker_id ?? null,
          brokerUserId: idRow?.broker_user_id ?? null,
          isMe: !!myName && name.trim().toLowerCase() === myName.trim().toLowerCase(),
          volume: c.volume, deals: c.deals, commission: c.commission,
          avgDeal: c.avgDeal, bps: c.bps, commissionPerDeal: c.commissionPerDeal,
          pyVolume: p.volume, pyDeals: p.deals, pyCommission: p.commission,
          sharePct: brokerTotalVolume ? c.volume / brokerTotalVolume : 0,
          volumeYoy: yoy(c.volume, p.volume),
          dealYoy: yoy(c.deals, p.deals),
          commissionYoy: yoy(c.commission, p.commission),
        };
      })
      .sort((a, b) => b.volume - a.volume)
      .map((x, i) => ({ rank: i + 1, ...x }));

    const availableAgents = uniq(scopedAll.map((r) => r.agent_name)).sort((a, b) => a.localeCompare(b));

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const wc = monthWindow(year, m);
      const wp = monthWindow(year - 1, m);
      const c = metrics(mine, wc);
      const p = metrics(mine, wp);
      return {
        month: m,
        cyVolume: c.volume,
        cyDeals: c.deals,
        cyCommission: c.commission,
        pyVolume: p.volume,
        pyDeals: p.deals,
        pyCommission: p.commission,
        volumeYoy: yoy(c.volume, p.volume),
        dealYoy: yoy(c.deals, p.deals),
        commissionYoy: yoy(c.commission, p.commission),
        avgDeal: c.avgDeal,
        bps: c.bps,
        commissionPerDeal: c.commissionPerDeal,
      };
    });

    const quarters = [1, 2, 3, 4].map((q) => {
      const wc = quarterWindow(year, q);
      const wp = quarterWindow(year - 1, q);
      const c = metrics(mine, wc);
      const p = metrics(mine, wp);
      return { quarter: q, ...c, pyVolume: p.volume, pyDeals: p.deals, pyCommission: p.commission };
    });

    const lenders = breakdown(mine, cyYtd, pyYtd, "institution");
    const products = breakdown(mine, cyYtd, pyYtd, "mortgage_type");
    const terms = breakdown(mine, cyYtd, pyYtd, "term");

    // Type x Term volume matrix
    const typeKeys = uniq(volumeTranches(mine, cyYtd).map((r) => r.mortgage_type));
    const termKeys = uniq(volumeTranches(mine, cyYtd).map((r) => r.term));
    const matrix = typeKeys.map((t) => ({
      type: t,
      cells: termKeys.map((tm) => ({
        term: tm,
        volume: periodVolume(mine, cyYtd, { mortgage_type: t, term: tm }),
      })),
      total: periodVolume(mine, cyYtd, { mortgage_type: t }),
    }));

    // Commission by type (all commission types, no dedup)
    const commissionTypes = uniq(
      mine.filter((r) => r.date_trans && r.date_trans >= cyYtd.start && r.date_trans <= cyYtd.end).map((r) => r.commission_type),
    ).map((t) => ({
      type: t,
      amount: mine
        .filter(
          (r) =>
            r.date_trans &&
            r.date_trans >= cyYtd.start &&
            r.date_trans <= cyYtd.end &&
            (r.commission_type ?? "") === t,
        )
        .reduce((s, r) => s + Number(r.amount ?? 0), 0),
    })).sort((a, b) => b.amount - a.amount);

    // Club Excellence — nominative standings across all brokers
    const seasonCur = seasonWindow(year - (month >= 8 ? 0 : 1));
    const seasonPrev = seasonWindow(year - (month >= 8 ? 1 : 2));
    const brokerNames = uniq(volumeTranches(allRows, seasonCur).map((r) => r.agent_name));
    const club = brokerNames
      .map((name) => {
        const c = metrics(allRows, seasonCur, { broker: name });
        const p = metrics(allRows, seasonPrev, { broker: name });
        const idRow = scopedAll.find((x) => x.agent_name === name) as any;
        return {
          broker: name,
          firstName: idRow?.first_name ?? null,
          lastName: idRow?.last_name ?? null,
          maestroBrokerId: idRow?.maestro_broker_id ?? null,
          brokerUserId: idRow?.broker_user_id ?? null,
          isMe: !!myName && name.trim().toLowerCase() === myName.trim().toLowerCase(),
          volume: c.volume,
          deals: c.deals,
          commission: c.commission,
          avgDeal: c.avgDeal,
          bps: c.bps,
          pyVolume: p.volume,
          pyDeals: p.deals,
          volumeYoy: yoy(c.volume, p.volume),
        };
      })
      .sort((a, b) => b.volume - a.volume)
      .map((x, i) => ({ rank: i + 1, ...x }));

    const clubMonthly = Array.from({ length: 12 }, (_, i) => {
      const m = ((7 + i) % 12) + 1; // Aug..Jul
      const y = m >= 8 ? Number(seasonCur.start.slice(0, 4)) : Number(seasonCur.start.slice(0, 4)) + 1;
      const w = monthWindow(y, m);
      const mm = metrics(mine, w);
      return { month: m, year: y, volume: mm.volume, deals: mm.deals, commission: mm.commission };
    });

    // Yearly history for the year filter
    const availableYearsRes = await admin
      .from("planipret_commission_register")
      .select("fiscal_year")
      .not("fiscal_year", "is", null)
      .limit(100000);
    const availableYears = Array.from(
      new Set(((availableYearsRes.data ?? []) as any[]).map((r) => r.fiscal_year as number)),
    ).sort((a, b) => b - a);

    // Reconciliation checks
    const lenderVolume = lenders.reduce((s, l) => s + l.cyVolume, 0);
    const lenderDeals = lenders.reduce((s, l) => s + l.cyDeals, 0);
    const productVolume = products.reduce((s, l) => s + l.cyVolume, 0);
    const termVolume = terms.reduce((s, l) => s + l.cyVolume, 0);
    const matrixVolume = matrix.reduce((s, r) => s + r.total, 0);
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const reconciliation = {
      volumeOk:
        near(lenderVolume, kpi.ytd.volume) && near(productVolume, kpi.ytd.volume) && near(termVolume, kpi.ytd.volume) && near(matrixVolume, kpi.ytd.volume),
      dealsOk: lenderDeals === kpi.ytd.deals,
      details: { kpiVolume: kpi.ytd.volume, lenderVolume, productVolume, termVolume, matrixVolume, kpiDeals: kpi.ytd.deals, lenderDeals },
    };

    return json({
      ok: true,
      year,
      month,
      scope,
      granularity,
      periodIndex,
      agent,
      window: cyYtd,
      priorWindow: pyYtd,
      periodLabel: resolved.label,
      isAdmin,
      brokerName: myName,
      rowCount: mine.length,
      availableYears,
      availableAgents,
      brokers,
      series,
      kpi,
      monthly,
      quarters,
      lenders,
      products,
      terms,
      matrix,
      termKeys,
      commissionTypes,
      club,
      clubMonthly,
      season: { current: seasonCur, previous: seasonPrev },
      reconciliation,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
