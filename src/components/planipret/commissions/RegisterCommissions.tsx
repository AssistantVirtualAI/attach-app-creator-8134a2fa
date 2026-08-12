import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart, RadialBarChart, RadialBar,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle, Trophy, FileDown, RotateCcw, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CommissionInsights from "./CommissionInsights";
import ClubExcellencePanel from "./ClubExcellencePanel";
import { Ov3DChartFilters, Ov3DGradients, fill3d } from "@/components/planipret/broker/overview/ov3dChart";
import RegisterFilters, { type Granularity } from "./RegisterFilters";
import BrokerLeaderboard from "./BrokerLeaderboard";
import CommissionDiscrepancies from "./CommissionDiscrepancies";
import CommissionCoverage from "./CommissionCoverage";
import BrokerDrilldown from "./BrokerDrilldown";
import { downloadCommissionsPdf } from "@/lib/planipret/commissionsPdf";
import { useAdminCommissionFilters, readAdminCommissionFilters, defaultAdminCommissionFilters } from "@/hooks/useAdminCommissionFilters";
import { ensureAiConsent } from "@/components/planipret/mobile/AiConsentHost";
import RegisterHealthBadge from "./RegisterHealthBadge";
import RegisterDealsTable, { type DealLine } from "./RegisterDealsTable";
import RegisterDrilldown, { dealsCsv } from "./RegisterDrilldown";

type Lang = "fr" | "en";
type Tab = "overview" | "brokers" | "trend" | "lenders" | "mix" | "quarters" | "periods" | "club" | "gaps" | "data" | "deals";


const PALETTE = ["#4472C4", "#70AD47", "#ED7D31", "#A5A5A5", "#FFC000", "#8B5CF6", "#EC4899", "#14B8A6"];


const fmtMoney = (v: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v || 0);
const fmtNum = (v: number) => new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 }).format(v || 0);
const fmtBps = (v: number) => `${(v || 0).toFixed(1)} BPS`;
const fmtPct = (v: number | string) =>
  typeof v === "number" ? `${(v * 100).toFixed(1)} %` : String(v ?? "—");

const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Delta({ value }: { value: number | string }) {
  if (typeof value !== "number") {
    return <span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{value}</span>;
  }
  const up = value >= 0;
  return (
    <span className="inline-flex items-center gap-0.5" style={{ fontSize: 11.5, fontWeight: 700, color: up ? "#16a34a" : "#ef4444" }}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {(value * 100).toFixed(1)} %
    </span>
  );
}

function Kpi({ label, value, delta, accent, onClick }: { label: string; value: string; delta?: number | string; accent: string; onClick?: () => void }) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      title={onClick ? "Voir les dossiers sous-jacents" : undefined}
      className={`ov3d-card${onClick ? " pp-drillable" : ""}`}
      style={{
        position: "relative", padding: 14, borderRadius: 14, overflow: "hidden",
        background: "linear-gradient(155deg, var(--pp-bg-elevated) 0%, var(--pp-bg-card) 100%)",
        border: "1px solid var(--pp-bg-border)",
        boxShadow: "0 10px 26px -18px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06)",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 70% at 0% 0%, ${accent}22, transparent 60%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent, opacity: .85 }} />
      <div style={{ fontSize: 11, letterSpacing: .4, textTransform: "uppercase", color: "var(--pp-text-muted)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: "var(--pp-text-primary)" }}>{value}</div>
      {delta !== undefined && <div className="mt-1"><Delta value={delta} /></div>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="pp-card" style={{ padding: 14, borderRadius: 14, marginTop: 12 }}>
      <div className="flex items-center justify-between mb-2">
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)" }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: "rgba(10,16,30,.92)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 10,
  color: "#fff",
  fontSize: 12,
  backdropFilter: "blur(8px)",
} as const;

function Table({ head, rows }: { head: string[]; rows: (string | number | JSX.Element)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{
                position: "sticky", top: 0, textAlign: i === 0 || i === 1 ? "left" : "right",
                padding: "8px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: .3,
                color: "var(--pp-text-muted)", fontWeight: 800,
                background: "linear-gradient(180deg, var(--pp-bg-elevated), transparent)",
                borderBottom: "1px solid var(--pp-bg-border)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? "rgba(127,127,127,.045)" : "transparent" }}>
              {r.map((c, ci) => (
                <td key={ci} style={{
                  padding: "7px 10px", textAlign: ci === 0 || ci === 1 ? "left" : "right",
                  whiteSpace: "nowrap", color: "var(--pp-text-primary)",
                  borderBottom: "1px solid var(--pp-bg-border)",
                }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RegisterCommissions({ lang, scope = "broker" }: { lang: Lang; scope?: "broker" | "admin" }) {
  const isFr = lang === "fr";
  const isAdminView = scope === "admin";
  const MONTHS = isFr ? MONTHS_FR : MONTHS_EN;
  const now = new Date();
  const scopeKey = isAdminView ? "admin" : "broker";
  const saved = readAdminCommissionFilters(scopeKey);
  const [year, setYear] = useState(saved?.year ?? now.getFullYear());
  const [month, setMonth] = useState(12);
  const [granularity, setGranularity] = useState<Granularity>((saved?.granularity as Granularity) ?? "ytd");
  const [periodIndex, setPeriodIndex] = useState(saved?.periodIndex ?? 12);
  const [agent, setAgent] = useState(isAdminView ? (saved?.agent ?? "") : "");
  const [lender, setLender] = useState(saved?.lender ?? "");
  const [tab, setTab] = useState<Tab>((saved?.tab as Tab) ?? "overview");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persist the admin filters in the browser so the same view reopens later.
  const { clear: clearSavedFilters } = useAdminCommissionFilters(true, { year, granularity, periodIndex, agent, lender, tab }, scopeKey);
  const resetFilters = () => {
    const d = defaultAdminCommissionFilters();
    clearSavedFilters();
    setYear(d.year);
    setGranularity(d.granularity as Granularity);
    setPeriodIndex(d.periodIndex);
    setAgent("");
    setLender("");
    setTab("overview");
  };

  // Broker drill-down
  const [drillAgent, setDrillAgent] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<any>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);


  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: res, error: err } = await supabase.functions.invoke("pp-commission-stats", {
          body: {
            year,
            month: granularity === "ytd" || granularity === "month" ? periodIndex : month,
            granularity,
            periodIndex,
            scope: isAdminView ? "all" : "self",
            agent: isAdminView && agent ? agent : null,
          },
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        if (err) throw err;
        if ((res as any)?.error) throw new Error((res as any).error);
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [year, month, granularity, periodIndex, agent, isAdminView]);

  // Drill-down fetch (admin only)
  useEffect(() => {
    if (!isAdminView || !drillAgent) return;
    let cancelled = false;
    (async () => {
      setDrillLoading(true); setDrillError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: res, error: err } = await supabase.functions.invoke("pp-commission-stats", {
          body: {
            year,
            month: granularity === "ytd" || granularity === "month" ? periodIndex : month,
            granularity,
            periodIndex,
            scope: "all",
            agent: null,
            detailAgent: drillAgent,
          },
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        if (err) throw err;
        if ((res as any)?.error) throw new Error((res as any).error);
        if (!cancelled) setDrillData((res as any)?.detail ?? null);
      } catch (e: any) {
        if (!cancelled) setDrillError(e?.message ?? "error");
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdminView, drillAgent, year, month, granularity, periodIndex]);


  const onGranularity = (g: Granularity) => {
    setGranularity(g);
    setPeriodIndex(g === "week" ? 1 : g === "quarter" ? Math.ceil(((new Date()).getMonth() + 1) / 3) : g === "month" ? (new Date()).getMonth() + 1 : 12);
  };

  const years: number[] = useMemo(() => {
    const list: number[] = data?.availableYears?.length ? data.availableYears : [];
    if (!list.includes(year)) list.push(year);
    return Array.from(new Set(list)).sort((a, b) => b - a);
  }, [data, year]);

  const trendData = useMemo(() => {
    if (data?.series) {
      return data.series.map((m: any) => ({
        name: m.label,
        cyVolume: m.cyVolume, pyVolume: m.pyVolume,
        cyCommission: m.cyCommission, pyCommission: m.pyCommission,
        bps: m.bps, deals: m.cyDeals,
      }));
    }
    return (data?.monthly ?? []).map((m: any) => ({
      name: MONTHS[m.month - 1],
      cyVolume: m.cyVolume, pyVolume: m.pyVolume,
      cyCommission: m.cyCommission, pyCommission: m.pyCommission,
      bps: m.bps, deals: m.cyDeals,
    }));
  }, [data, MONTHS]);

  const cumulative = useMemo(() => {
    let cy = 0, py = 0;
    return trendData.map((m: any) => {
      cy += m.cyVolume || 0; py += m.pyVolume || 0;
      return {
        ...m,
        cyCum: cy,
        pyCum: py,
        commPerDeal: m.deals ? (m.cyCommission || 0) / m.deals : 0,
      };
    });
  }, [trendData]);

  const kpi = data?.kpi;

  /* ---- Advanced filtering (lender) applied client-side on the deal lines ---- */
  const allDeals: DealLine[] = useMemo(() => (data?.deals ?? []) as DealLine[], [data]);
  const lenderOptions: string[] = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDeals) if (d.institution) set.add(d.institution);
    for (const l of (data?.lenders ?? [])) if (l?.key) set.add(l.key);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allDeals, data]);

  const filteredDeals: DealLine[] = useMemo(
    () => (lender ? allDeals.filter((d) => d.institution === lender) : allDeals),
    [allDeals, lender],
  );

  const filteredTotals = useMemo(() => {
    const volume = filteredDeals.filter((d) => d.countedInVolume).reduce((s2, d) => s2 + (d.loanAmt || 0), 0);
    const commission = filteredDeals.reduce((s2, d) => s2 + (d.amount || 0), 0);
    const count = filteredDeals.filter((d) => d.countedInDeals).length;
    return { volume, commission, count, bps: volume ? (commission / volume) * 10000 : 0 };
  }, [filteredDeals]);

  /* ---- Drill-down modal ---- */
  const [drill, setDrill] = useState<{ title: string; subtitle?: string; deals: DealLine[] } | null>(null);
  const openDrill = (title: string, deals: DealLine[], subtitle?: string) => setDrill({ title, deals, subtitle });
  const periodSubtitle = `${data?.periodLabel ?? year}${lender ? ` · ${lender}` : ""}${agent ? ` · ${agent}` : ""}`;


  // ---- AI insights (Claude), cached 24h per user/year/month ----
  const [ai, setAi] = useState<{ summary: string; insights: any[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const generateInsights = async (force = false) => {
    if (!data || data.rowCount === 0) return;
    const cacheKey = `pp-register-insights:${isAdminView ? "admin" : (data.brokerName ?? "me")}:${agent || "all"}:${year}:${granularity}:${periodIndex}:${lang}`;
    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.ts < 24 * 3600 * 1000) { setAi(parsed.value); return; }
        }
      } catch { /* ignore */ }
    }
    if (!(await ensureAiConsent())) return;
    setAiLoading(true); setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        lang, scope: isAdminView && !agent ? "admin" : "broker", source: "register",
        metrics: {
          year, period: data.periodLabel, granularity, window: data.window,
          agent: agent || (isAdminView ? "all brokers" : data.brokerName),
          brokers: isAdminView ? (data.brokers ?? []).slice(0, 20) : undefined,
          ytd: data.kpi.ytd, ytdPriorYear: data.kpi.ytdPy,
          monthly: data.monthly, quarters: data.quarters,
          lenders: data.lenders.slice(0, 12), products: data.products, terms: data.terms,
          commissionTypes: data.commissionTypes,
          clubRank: data.club.find((c: any) => c.isMe)?.rank ?? null,
          clubSize: data.club.length,
        },
      };
      const { data: res, error: err } = await supabase.functions.invoke("pp-commissions-insights", {
        body: payload,
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (err) throw err;
      const value = { summary: (res as any)?.summary ?? "", insights: (res as any)?.insights ?? [] };
      setAi(value);
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch { /* ignore */ }
    } catch (e: any) {
      setAiError(e?.message ?? "AI error");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    setAi(null);
    if (data && data.rowCount > 0) void generateInsights(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rowCount, year, granularity, periodIndex, agent]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: isFr ? "Vue d'ensemble" : "Overview" },
    ...(isAdminView ? [{ key: "brokers" as Tab, label: isFr ? "Courtiers" : "Brokers" }] : []),
    { key: "trend", label: isFr ? "Tendance" : "Trend" },
    { key: "lenders", label: isFr ? "Prêteurs" : "Lenders" },
    { key: "mix", label: isFr ? "Mix produits" : "Product mix" },
    ...(isAdminView ? [{ key: "quarters" as Tab, label: isFr ? "Trimestres" : "Quarters" }] : []),
    ...(isAdminView ? [{ key: "periods" as Tab, label: isFr ? "Stats par période" : "Stats by period" }] : []),
    { key: "club", label: "Club Excellence" },
    { key: "deals", label: isFr ? "Dossiers" : "Deals" },
    ...(isAdminView ? [{ key: "gaps" as Tab, label: isFr ? "Écarts" : "Gaps" }] : []),
    ...(isAdminView ? [{ key: "data" as Tab, label: isFr ? "Couverture des données" : "Data coverage" }] : []),
  ];



  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <RegisterFilters
          lang={lang}
          years={years}
          year={year}
          onYear={setYear}
          granularity={granularity}
          onGranularity={onGranularity}
          periodIndex={periodIndex}
          onPeriodIndex={setPeriodIndex}
          agents={data?.availableAgents ?? []}
          agent={agent}
          onAgent={setAgent}
          showAgent={isAdminView}
          lenders={lenderOptions}
          lender={lender}
          onLender={setLender}
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--pp-text-muted)" }} />}
        {data?.reconciliation && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
            fontSize: 11.5, fontWeight: 700,
            background: data.reconciliation.allOk ?? (data.reconciliation.volumeOk && data.reconciliation.dealsOk) ? "rgba(22,163,74,.12)" : "rgba(245,158,11,.14)",
            color: data.reconciliation.allOk ?? (data.reconciliation.volumeOk && data.reconciliation.dealsOk) ? "#16a34a" : "#f59e0b",
          }}>
            {(data.reconciliation.allOk ?? (data.reconciliation.volumeOk && data.reconciliation.dealsOk))
              ? <><ShieldCheck className="w-3.5 h-3.5" />{isFr ? "Totaux réconciliés" : "Totals reconciled"}</>
              : <><AlertTriangle className="w-3.5 h-3.5" />{isFr ? "Écart de réconciliation" : "Reconciliation gap"}</>}
          </span>
        )}
        {data?.window && (
          <span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
            {data.window.start} → {data.window.end}
            {isAdminView && !agent ? (isFr ? " · tous les courtiers" : " · all brokers") : agent ? ` · ${agent}` : ""}
          </span>
        )}
        {(
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => dealsCsv(filteredDeals, `commissions-${year}${lender ? `-${lender}` : ""}.csv`)}
              disabled={filteredDeals.length === 0}
              title={isFr ? "Exporter le résultat filtré" : "Export the filtered result"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ fontSize: 12, fontWeight: 700, opacity: filteredDeals.length ? 1 : .5, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
              <FileDown className="w-3.5 h-3.5" />{isFr ? "Export CSV" : "Export CSV"}
            </button>
            {isAdminView && data?.discrepancies?.total > 0 && (
              <button onClick={() => setTab("gaps")} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ fontSize: 11.5, fontWeight: 800, background: "rgba(245,158,11,.14)", color: "#f59e0b", border: "1px solid rgba(245,158,11,.25)" }}>
                <AlertTriangle className="w-3.5 h-3.5" />{fmtNum(data.discrepancies.total)} {isFr ? "écarts" : "gaps"}
              </button>
            )}
            {isAdminView && <button
              onClick={() => data && downloadCommissionsPdf({ lang, data, agent, aiSummary: ai?.summary, year })}
              disabled={!data}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{
                fontSize: 12, fontWeight: 700, opacity: data ? 1 : .5,
                background: "var(--pp-brand-accent-2)", color: "#fff", border: "1px solid var(--pp-bg-border)",
              }}>
              <FileDown className="w-3.5 h-3.5" />{isFr ? "Rapport PDF" : "PDF report"}
            </button>}
            <button onClick={resetFilters} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ fontSize: 12, fontWeight: 700, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
              <RotateCcw className="w-3.5 h-3.5" />{isFr ? "Réinitialiser" : "Reset"}
            </button>
          </div>
        )}
      </div>

      {lender && (
        <div className="flex flex-wrap items-center gap-2 mb-2 rounded-xl" style={{ padding: "8px 10px", border: "1px solid var(--pp-brand-accent-2, #2E9BDC)", background: "color-mix(in srgb, var(--pp-brand-accent-2, #2E9BDC) 10%, transparent)" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--pp-text-primary)" }}>
            {isFr ? "Résultat filtré" : "Filtered result"} · {lender}
          </span>
          <span style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>
            {fmtNum(filteredTotals.count)} {isFr ? "dossiers" : "deals"} · {fmtMoney(filteredTotals.volume)} · {fmtMoney(filteredTotals.commission)} · {fmtBps(filteredTotals.bps)}
          </span>
          <button
            onClick={() => openDrill(lender, filteredDeals, periodSubtitle)}
            className="px-2 py-1 rounded-lg"
            style={{ fontSize: 11.5, fontWeight: 700, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {isFr ? "Voir les dossiers" : "View deals"}
          </button>
          <button onClick={() => setLender("")} className="ml-auto px-2 py-1 rounded-lg"
            style={{ fontSize: 11.5, fontWeight: 700, background: "transparent", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-muted)" }}>
            {isFr ? "Effacer" : "Clear"}
          </button>
        </div>
      )}

      <RegisterHealthBadge integrity={data?.integrity} lang={lang} />

      <div className="flex flex-wrap gap-1.5 mb-2">

        {tabs.map((t) => {
          const isClub = t.key === "club";
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
              style={{
                fontSize: 12.5, fontWeight: isClub ? 800 : 700,
                background: isClub
                  ? (active
                    ? "linear-gradient(135deg, #FFC000, #E8A33C)"
                    : "linear-gradient(135deg, rgba(255,192,0,.16), rgba(255,192,0,.05))")
                  : active ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
                color: isClub ? (active ? "#1b1400" : "#FFC000") : active ? "#fff" : "var(--pp-text-secondary)",
                border: isClub ? "1px solid rgba(255,192,0,.45)" : "1px solid var(--pp-bg-border)",
                boxShadow: isClub ? "0 12px 22px -16px rgba(255,192,0,.8), inset 0 1px 0 rgba(255,255,255,.25)" : undefined,
              }}>
              {isClub && <Star className="w-3.5 h-3.5" style={{ fill: active ? "#1b1400" : "#FFC000" }} />}
              {t.label}
            </button>
          );
        })}
      </div>


      {error && <div className="pp-card" style={{ padding: 12, fontSize: 12.5, color: "var(--pp-danger,#ef4444)" }}>{error}</div>}

      {!error && !data && loading && (
        <div className="pp-card" style={{ padding: 24, textAlign: "center", color: "var(--pp-text-muted)", fontSize: 13 }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      )}

      {data && data.rowCount === 0 && (
        <div
          className="pp-card"
          style={{
            padding: 28, borderRadius: 16, textAlign: "center",
            background: "linear-gradient(155deg, var(--pp-bg-elevated) 0%, var(--pp-bg-card) 100%)",
            border: "1px solid var(--pp-bg-border)",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--pp-text-primary)" }}>
            {isFr ? "Aucune commission pour cette période" : "No commission for this period"}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--pp-text-muted)", marginTop: 6, maxWidth: 460, marginInline: "auto", lineHeight: 1.6 }}>
            {isFr
              ? "Aucune ligne du registre de dépôts n'est rattachée à votre profil sur cette période. Essayez une autre année, ou connectez votre compte Maestro pour suivre vos commissions en temps réel."
              : "No deposit-register line is linked to your profile for this period. Try another year, or connect your Maestro account to track commissions in real time."}
          </p>
        </div>
      )}

      {data && data.rowCount > 0 && (
        <div className="ov3d-stage">
          <Ov3DChartFilters />
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
            <Ov3DGradients colors={["#4472C4", "#70AD47", "#ED7D31", "#A5A5A5", "#FFC000", "#8B5CF6", "#EC4899", "#14B8A6"]} />
          </svg>
          {tab === "overview" && (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                <Kpi label={isFr ? "Volume" : "Volume"} value={fmtMoney(kpi.ytd.volume)} delta={pctDelta(kpi.ytd.volume, kpi.ytdPy.volume)} accent="#4472C4"
                  onClick={() => openDrill(isFr ? "Volume — dossiers sous-jacents" : "Volume — underlying deals", filteredDeals.filter((d) => d.countedInVolume), periodSubtitle)} />
                <Kpi label={isFr ? "Dossiers" : "Deals"} value={fmtNum(kpi.ytd.deals)} delta={pctDelta(kpi.ytd.deals, kpi.ytdPy.deals)} accent="#70AD47"
                  onClick={() => openDrill(isFr ? "Dossiers" : "Deals", filteredDeals.filter((d) => d.countedInDeals), periodSubtitle)} />
                <Kpi label="Commission" value={fmtMoney(kpi.ytd.commission)} delta={pctDelta(kpi.ytd.commission, kpi.ytdPy.commission)} accent="#ED7D31"
                  onClick={() => openDrill("Commission", filteredDeals.filter((d) => (d.amount || 0) !== 0), periodSubtitle)} />
                <Kpi label={isFr ? "Dossier moyen" : "Avg deal"} value={fmtMoney(kpi.ytd.avgDeal)} accent="#FFC000"
                  onClick={() => openDrill(isFr ? "Dossier moyen" : "Avg deal", filteredDeals.filter((d) => d.countedInDeals), periodSubtitle)} />
                <Kpi label="BPS" value={fmtBps(kpi.ytd.bps)} accent="#8B5CF6"
                  onClick={() => openDrill("BPS", filteredDeals, periodSubtitle)} />
                <Kpi label={isFr ? "Prêteurs actifs" : "Active lenders"} value={fmtNum(kpi.activeLenders)} accent="#14B8A6"
                  onClick={() => openDrill(isFr ? "Prêteurs actifs" : "Active lenders", filteredDeals, periodSubtitle)} />
                {isAdminView && (
                  <Kpi label={isFr ? "Courtiers actifs" : "Active brokers"} value={fmtNum(kpi.activeBrokers)} accent="#EC4899" />
                )}
              </div>

              <Section title={isFr ? "Volume mensuel — année courante vs précédente" : "Monthly volume — CY vs PY"}>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={trendData}>
                      <defs>
                        <linearGradient id="gCy" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#5B8FF9" /><stop offset="100%" stopColor="#2F5FBF" />
                        </linearGradient>
                        <linearGradient id="gPy" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#B9C4D6" /><stop offset="100%" stopColor="#8895AA" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                      <Bar name={String(year)} dataKey="cyVolume" fill="url(#gCy)" radius={[5, 5, 0, 0]} />
                      <Bar name={String(year - 1)} dataKey="pyVolume" fill="url(#gPy)" radius={[5, 5, 0, 0]} />
                      <Line name="BPS" dataKey="bps" stroke="#FFC000" strokeWidth={2} dot={false} yAxisId={0} hide />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              <div className="mt-3">
                <CommissionInsights
                  lang={lang}
                  summary={ai?.summary ?? ""}
                  insights={(ai?.insights ?? []) as any}
                  loading={aiLoading}
                  error={aiError}
                  generated={!!ai}
                  onGenerate={() => void generateInsights(true)}
                />
              </div>

              <Section title={isFr ? "Commission par type" : "Commission by type"}>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={data.commissionTypes} dataKey="amount" nameKey="type" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {data.commissionTypes.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
                <Section title={isFr ? "Volume cumulé — courbe de progression" : "Cumulative volume — pace curve"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <AreaChart data={cumulative}>
                        <defs>
                          <linearGradient id="gCumCy" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5B8FF9" stopOpacity={0.75} />
                            <stop offset="100%" stopColor="#5B8FF9" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gCumPy" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#A5A5A5" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#A5A5A5" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000000)}M`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11.5 }} />
                        <Area name={String(year - 1)} dataKey="pyCum" stroke="#A5A5A5" fill="url(#gCumPy)" strokeWidth={2} />
                        <Area name={String(year)} dataKey="cyCum" stroke="#5B8FF9" fill="url(#gCumCy)" strokeWidth={2.4} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Section>

                <Section title={isFr ? "Dossiers vs commission par dossier" : "Deals vs commission per deal"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={cumulative}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [n === (isFr ? "Dossiers" : "Deals") ? fmtNum(Number(v)) : fmtMoney(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11.5 }} />
                        <Bar yAxisId="l" name={isFr ? "Dossiers" : "Deals"} dataKey="deals" fill={fill3d("#70AD47")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                        <Line yAxisId="r" name={isFr ? "Comm./dossier" : "Comm./deal"} dataKey="commPerDeal" stroke="#FFC000" strokeWidth={2.4} dot={{ r: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Section>

                <Section title={isFr ? "Concentration des prêteurs (top 6)" : "Lender concentration (top 6)"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <RadialBarChart data={(data.lenders ?? []).slice(0, 6).map((l: any, i: number) => ({
                        name: l.key, value: l.cyVolume, fill: PALETTE[i % PALETTE.length],
                      }))} innerRadius="25%" outerRadius="95%" startAngle={90} endAngle={-270}>
                        <RadialBar background dataKey="value" cornerRadius={6} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, _n: any, p: any) => [fmtMoney(Number(v)), p?.payload?.name]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
                      </RadialBarChart>
                    </ResponsiveContainer>
                  </div>
                </Section>

                <Section title={isFr ? "BPS par mois (rentabilité)" : "BPS per month (yield)"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <AreaChart data={cumulative}>
                        <defs>
                          <linearGradient id="gBps" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.7} />
                            <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.04} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtBps(Number(v))} />
                        <Area name="BPS" dataKey="bps" stroke="#8B5CF6" fill="url(#gBps)" strokeWidth={2.2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Section>
              </div>

              <Section title={isFr ? "Notes de lecture" : "Reading notes"}>
                <ul style={{ fontSize: 12, color: "var(--pp-text-secondary)", lineHeight: 1.65, paddingLeft: 16, listStyle: "disc" }}>
                  <li>{isFr ? "La courbe cumulée compare le rythme de l'année courante à celui de l'année précédente sur la même fenêtre." : "The cumulative curve compares the current year pace to the prior year over the same window."}</li>
                  <li>{isFr ? "BPS = commission / volume × 10 000 ; une baisse de BPS avec un volume en hausse signale un mix moins rémunérateur." : "BPS = commission / volume × 10,000; falling BPS with rising volume signals a less profitable mix."}</li>
                  <li>{isFr ? "La concentration des prêteurs mesure le risque : plus de 50 % du volume chez un seul prêteur est un signal d'attention." : "Lender concentration measures risk: over 50% of volume with a single lender is a warning signal."}</li>
                  <li>{isFr ? "Tous les chiffres proviennent du registre de dépôts importé (onglets 2022→2026), sans retraitement manuel." : "All figures come from the imported deposit register (2022→2026 sheets), with no manual adjustment."}</li>
                </ul>
              </Section>

            </>
          )}

          {tab === "brokers" && (
            <>
              <div
                className="mb-3 rounded-xl px-3 py-2.5"
                style={{
                  background: "var(--pp-bg-elevated)",
                  border: "1px solid var(--pp-bg-border)",
                  fontSize: 12.5,
                  color: "var(--pp-text-secondary)",
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 4 }}>
                  {isFr ? "Couverture du registre importé" : "Imported register coverage"}
                </div>
                <div>
                  {isFr
                    ? `${(data.availableAgents ?? []).length} courtier(s) présent(s) dans le registre · ${fmtNum(data.totalRows ?? 0)} ligne(s) sur la période.`
                    : `${(data.availableAgents ?? []).length} broker(s) found in the register · ${fmtNum(data.totalRows ?? 0)} row(s) in period.`}
                </div>
                {(data.availableAgents ?? []).length > 0 && (
                  <div style={{ marginTop: 4, opacity: 0.9 }}>
                    {(data.availableAgents ?? []).join(" · ")}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.85 }}>
                  {isFr
                    ? "Le nombre de courtiers reflète uniquement le fichier importé. Pour voir toute l'entreprise, importez un registre global (toutes les lignes) plutôt qu'un tableau de bord individuel."
                    : "Broker count reflects the imported file only. To see the whole firm, import a company-wide register instead of an individual dashboard export."}
                </div>
              </div>
              <BrokerLeaderboard
                lang={lang}
                brokers={data.brokers ?? []}
                periodLabel={`${data.window?.start} → ${data.window?.end}`}
                onSelect={(b) => { setDrillData(null); setDrillAgent(b); }}
              />
            </>
          )}


          {tab === "gaps" && isAdminView && (
            <CommissionDiscrepancies lang={lang} discrepancies={data.discrepancies} />
          )}

          {tab === "data" && isAdminView && <CommissionCoverage lang={lang} />}



          {tab === "trend" && (
            <>
              <Section title={isFr ? "Commission mensuelle — CY vs PY" : "Monthly commission — CY vs PY"}>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                      <Bar name={String(year)} dataKey="cyCommission" fill={fill3d("#ED7D31")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                      <Bar name={String(year - 1)} dataKey="pyCommission" fill={fill3d("#A5A5A5")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Section>
              <Section title={isFr ? "Détail mensuel" : "Monthly detail"}>
                <Table
                  head={[isFr ? "Mois" : "Month", "", isFr ? "Volume" : "Volume", isFr ? "Doss." : "Deals", "Commission",
                    isFr ? "Vol. PY" : "PY vol.", "YoY vol.", "YoY comm.", isFr ? "Doss. moy." : "Avg deal", "BPS"]}
                  rows={(data.monthly ?? []).map((m: any) => [
                    MONTHS[m.month - 1], "", fmtMoney(m.cyVolume), fmtNum(m.cyDeals), fmtMoney(m.cyCommission),
                    fmtMoney(m.pyVolume), <Delta key="a" value={m.volumeYoy} />, <Delta key="b" value={m.commissionYoy} />,
                    fmtMoney(m.avgDeal), fmtBps(m.bps),
                  ])}
                />
              </Section>
            </>
          )}

          {tab === "lenders" && (
            <>
              <Section title={isFr ? "Top 10 prêteurs — volume CY vs PY" : "Top 10 lenders — volume CY vs PY"}>
                <div style={{ height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.lenders.slice(0, 10)} layout="vertical" margin={{ left: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <YAxis type="category" dataKey="key" width={130} tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                      <Bar name={String(year)} dataKey="cyVolume" fill={fill3d("#4472C4")} radius={[0, 5, 5, 0]}  filter="url(#ov3dExtrude)" />
                      <Bar name={String(year - 1)} dataKey="pyVolume" fill={fill3d("#A5A5A5")} radius={[0, 5, 5, 0]}  filter="url(#ov3dExtrude)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
              <Section title={isFr ? "Classement des prêteurs" : "Lender ranking"}>
                <Table
                  head={["#", isFr ? "Prêteur" : "Lender", "Volume", isFr ? "Doss." : "Deals", "Commission", "BPS",
                    "% vol.", isFr ? "Vol. PY" : "PY vol.", "YoY vol.", "YoY comm."]}
                  rows={data.lenders.map((l: any) => [
                    l.rank,
                    <button
                      key={`l-${l.key}`}
                      onClick={() => openDrill(l.key, allDeals.filter((d) => d.institution === l.key), periodSubtitle)}
                      style={{ fontWeight: 700, color: "var(--pp-text-primary)", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                    >
                      {l.key}
                    </button>, fmtMoney(l.cyVolume), fmtNum(l.cyDeals), fmtMoney(l.cyCommission), fmtBps(l.cyBps),
                    fmtPct(l.sharePct), fmtMoney(l.pyVolume), <Delta key="a" value={l.volumeYoy} />, <Delta key="b" value={l.commissionYoy} />,
                  ])}
                />
              </Section>
            </>
          )}

          {tab === "mix" && (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
                <Section title={isFr ? "Mix par type de prêt" : "Product mix"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={data.products} dataKey="cyVolume" nameKey="key" innerRadius={50} outerRadius={88} paddingAngle={2}>
                          {data.products.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11.5 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Section>
                <Section title={isFr ? "Mix par terme" : "Term mix"}>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart data={data.terms}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                        <XAxis dataKey="key" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtMoney(Number(v))} />
                        <Bar dataKey="cyVolume" name="Volume" fill={fill3d("#70AD47")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Section>
              </div>

              <Section title={isFr ? "Matrice type × terme (volume)" : "Type × term matrix (volume)"}>
                <Table
                  head={[isFr ? "Type" : "Type", "", ...data.termKeys, "Total"]}
                  rows={data.matrix.map((r: any) => [
                    r.type, "", ...r.cells.map((c: any) => fmtMoney(c.volume)), fmtMoney(r.total),
                  ])}
                />
              </Section>
            </>
          )}

          {tab === "quarters" && (
            <Section title={isFr ? "Résumé trimestriel" : "Quarter summary"}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <ComposedChart data={data.quarters.map((q: any) => ({ name: `Q${q.quarter}`, ...q }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    <Bar name={String(year)} dataKey="volume" fill={fill3d("#4472C4")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                    <Bar name={String(year - 1)} dataKey="pyVolume" fill={fill3d("#A5A5A5")} radius={[5, 5, 0, 0]}  filter="url(#ov3dExtrude)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <Table
                  head={[isFr ? "Trimestre" : "Quarter", "", "Volume", isFr ? "Doss." : "Deals", "Commission", isFr ? "Doss. moy." : "Avg deal", "BPS"]}
                  rows={data.quarters.map((q: any) => [
                    `Q${q.quarter}`, "", fmtMoney(q.volume), fmtNum(q.deals), fmtMoney(q.commission), fmtMoney(q.avgDeal), fmtBps(q.bps),
                  ])}
                />
              </div>
            </Section>
          )}

          {tab === "periods" && (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                <Kpi label={isFr ? "Volume — période" : "Volume — period"} value={fmtMoney(kpi.ytd.volume)} delta={pctDelta(kpi.ytd.volume, kpi.ytdPy.volume)} accent="#4472C4" />
                <Kpi label={isFr ? "Dossiers — période" : "Deals — period"} value={fmtNum(kpi.ytd.deals)} delta={pctDelta(kpi.ytd.deals, kpi.ytdPy.deals)} accent="#70AD47" />
                <Kpi label={isFr ? "Commission — période" : "Commission — period"} value={fmtMoney(kpi.ytd.commission)} delta={pctDelta(kpi.ytd.commission, kpi.ytdPy.commission)} accent="#ED7D31" />
                <Kpi label={isFr ? "Commission / dossier" : "Commission / deal"} value={fmtMoney(kpi.ytd.deals ? kpi.ytd.commission / kpi.ytd.deals : 0)} accent="#8B5CF6" />
              </div>

              <Section title={isFr ? "Volume, dossiers et commission par mois" : "Volume, deals and commission by month"}>
                <Table
                  head={[isFr ? "Mois" : "Month", "", "Volume", isFr ? "Doss." : "Deals", "Commission", isFr ? "Comm./doss." : "Comm./deal", "BPS"]}
                  rows={(data.monthly ?? []).map((m: any) => [
                    MONTHS[m.month - 1], "", fmtMoney(m.cyVolume), fmtNum(m.cyDeals), fmtMoney(m.cyCommission),
                    fmtMoney(m.cyDeals ? m.cyCommission / m.cyDeals : 0), fmtBps(m.bps),
                  ])}
                />
              </Section>

              <Section title={isFr ? "Par trimestre" : "By quarter"}>
                <Table
                  head={[isFr ? "Trimestre" : "Quarter", "", "Volume", isFr ? "Doss." : "Deals", "Commission", isFr ? "Comm./doss." : "Comm./deal", "BPS"]}
                  rows={(data.quarters ?? []).map((q: any) => [
                    `Q${q.quarter}`, "", fmtMoney(q.volume), fmtNum(q.deals), fmtMoney(q.commission),
                    fmtMoney(q.deals ? q.commission / q.deals : 0), fmtBps(q.bps),
                  ])}
                />
              </Section>
            </>
          )}


          {tab === "club" && (
            <ClubExcellencePanel
              lang={lang}
              data={data}
              isAdminView={isAdminView}
              onBroker={(b) => { setDrillData(null); setDrillAgent(b); }}
            />
          )}

          {tab === "deals" && (
            <RegisterDealsTable deals={filteredDeals as any} lang={lang} />
          )}

          {isAdminView && Array.isArray(data.reconciliation?.checks) && (

            <Section title={isFr ? "Contrôles de réconciliation (MATCH / MISMATCH)" : "Reconciliation checks (MATCH / MISMATCH)"}>
              <Table
                head={[isFr ? "Contrôle" : "Check", isFr ? "Attendu" : "Expected", isFr ? "Obtenu" : "Actual", "Écart", "Statut"]}
                rows={data.reconciliation.checks.map((c: any) => [
                  c.label,
                  c.key.includes("Deals") ? fmtNum(c.expected) : fmtMoney(c.expected),
                  c.key.includes("Deals") ? fmtNum(c.actual) : fmtMoney(c.actual),
                  c.key.includes("Deals") ? fmtNum(c.delta) : fmtMoney(c.delta),
                  <span key="s" className="inline-flex items-center gap-1" style={{ fontWeight: 800, fontSize: 11.5, color: c.ok ? "#16a34a" : "#ef4444" }}>
                    {c.ok ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{c.status}
                  </span>,
                ])}
              />
              {data.reconciliation.quarterCheck && (
                <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)", marginTop: 8 }}>
                  {data.reconciliation.quarterCheck.applicable
                    ? `${isFr ? "Trimestres complets inclus" : "Completed quarters included"} : ${data.reconciliation.quarterCheck.quarters.map((q: number) => `Q${q}`).join(", ")} · ${fmtMoney(data.reconciliation.quarterCheck.volume)} · ${fmtNum(data.reconciliation.quarterCheck.deals)} ${isFr ? "doss." : "deals"} · ${fmtMoney(data.reconciliation.quarterCheck.commission)}`
                    : data.reconciliation.quarterCheck.note}
                </div>
              )}
            </Section>
          )}

          {isAdminView && Array.isArray(data.calcNotes) && (
            <Section title={isFr ? "Notes de calcul" : "Calculation notes"}>
              <ul style={{ fontSize: 12, color: "var(--pp-text-secondary)", lineHeight: 1.6, paddingLeft: 16, listStyle: "disc" }}>
                {data.calcNotes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            </Section>
          )}
        </div>
      )}

      <RegisterDrilldown
        open={!!drill}
        onClose={() => setDrill(null)}
        lang={lang}
        title={drill?.title ?? ""}
        subtitle={drill?.subtitle}
        deals={drill?.deals ?? []}
        contextLabel={data?.periodLabel}
      />

      {isAdminView && drillAgent && (
        <BrokerDrilldown
          lang={lang}
          detail={drillData}
          loading={drillLoading}
          error={drillError}
          onClose={() => { setDrillAgent(null); setDrillData(null); setDrillError(null); }}
        />
      )}
    </div>

  );
}

function pctDelta(cy: number, py: number): number | string {
  if (!py) return cy ? "New" : "—";
  return (cy - py) / py;
}
