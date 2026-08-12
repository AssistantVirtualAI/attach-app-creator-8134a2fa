import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CommissionInsights from "./CommissionInsights";
import RegisterFilters, { type Granularity } from "./RegisterFilters";
import BrokerLeaderboard from "./BrokerLeaderboard";
import { ensureAiConsent } from "@/components/planipret/mobile/AiConsentHost";

type Lang = "fr" | "en";
type Tab = "overview" | "brokers" | "trend" | "lenders" | "mix" | "quarters" | "club";

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

function Kpi({ label, value, delta, accent }: { label: string; value: string; delta?: number | string; accent: string }) {
  return (
    <div
      className="ov3d-card"
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
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(12);
  const [granularity, setGranularity] = useState<Granularity>("ytd");
  const [periodIndex, setPeriodIndex] = useState(12);
  const [agent, setAgent] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const kpi = data?.kpi;

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
    { key: "trend", label: isFr ? "Tendance mensuelle" : "Monthly trend" },
    { key: "lenders", label: isFr ? "Prêteurs" : "Lenders" },
    { key: "mix", label: isFr ? "Mix produits & termes" : "Product & term mix" },
    { key: "quarters", label: isFr ? "Trimestres" : "Quarters" },
    { key: "club", label: "Club Excellence" },
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
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-3 py-1.5 rounded-lg"
            style={{
              fontSize: 12.5, fontWeight: 700,
              background: tab === t.key ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
              color: tab === t.key ? "#fff" : "var(--pp-text-secondary)",
              border: "1px solid var(--pp-bg-border)",
            }}>{t.label}</button>
        ))}
      </div>

      {error && <div className="pp-card" style={{ padding: 12, fontSize: 12.5, color: "var(--pp-danger,#ef4444)" }}>{error}</div>}

      {!error && !data && loading && (
        <div className="pp-card" style={{ padding: 24, textAlign: "center", color: "var(--pp-text-muted)", fontSize: 13 }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      )}

      {data && data.rowCount === 0 && (
        <div className="pp-card" style={{ padding: 20, fontSize: 13, color: "var(--pp-text-muted)" }}>
          {isFr
            ? "Aucune donnée de registre pour cette période. L'administrateur doit importer le registre de dépôts."
            : "No register data for this period. An administrator must import the deposit register."}
        </div>
      )}

      {data && data.rowCount > 0 && (
        <>
          {tab === "overview" && (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                <Kpi label={isFr ? "Volume" : "Volume"} value={fmtMoney(kpi.ytd.volume)} delta={pctDelta(kpi.ytd.volume, kpi.ytdPy.volume)} accent="#4472C4" />
                <Kpi label={isFr ? "Dossiers" : "Deals"} value={fmtNum(kpi.ytd.deals)} delta={pctDelta(kpi.ytd.deals, kpi.ytdPy.deals)} accent="#70AD47" />
                <Kpi label="Commission" value={fmtMoney(kpi.ytd.commission)} delta={pctDelta(kpi.ytd.commission, kpi.ytdPy.commission)} accent="#ED7D31" />
                <Kpi label={isFr ? "Dossier moyen" : "Avg deal"} value={fmtMoney(kpi.ytd.avgDeal)} accent="#FFC000" />
                <Kpi label="BPS" value={fmtBps(kpi.ytd.bps)} accent="#8B5CF6" />
                <Kpi label={isFr ? "Prêteurs actifs" : "Active lenders"} value={fmtNum(kpi.activeLenders)} accent="#14B8A6" />
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
            </>
          )}

          {tab === "brokers" && (
            <BrokerLeaderboard
              lang={lang}
              brokers={data.brokers ?? []}
              periodLabel={`${data.window?.start} → ${data.window?.end}`}
              onSelect={(b) => setAgent(b)}
            />
          )}

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
                      <Bar name={String(year)} dataKey="cyCommission" fill="#ED7D31" radius={[5, 5, 0, 0]} />
                      <Bar name={String(year - 1)} dataKey="pyCommission" fill="#A5A5A5" radius={[5, 5, 0, 0]} />
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
                      <Bar name={String(year)} dataKey="cyVolume" fill="#4472C4" radius={[0, 5, 5, 0]} />
                      <Bar name={String(year - 1)} dataKey="pyVolume" fill="#A5A5A5" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
              <Section title={isFr ? "Classement des prêteurs" : "Lender ranking"}>
                <Table
                  head={["#", isFr ? "Prêteur" : "Lender", "Volume", isFr ? "Doss." : "Deals", "Commission", "BPS",
                    "% vol.", isFr ? "Vol. PY" : "PY vol.", "YoY vol.", "YoY comm."]}
                  rows={data.lenders.map((l: any) => [
                    l.rank, l.key, fmtMoney(l.cyVolume), fmtNum(l.cyDeals), fmtMoney(l.cyCommission), fmtBps(l.cyBps),
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
                        <Bar dataKey="cyVolume" name="Volume" fill="#70AD47" radius={[5, 5, 0, 0]} />
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
                    <Bar name={String(year)} dataKey="volume" fill="#4472C4" radius={[5, 5, 0, 0]} />
                    <Bar name={String(year - 1)} dataKey="pyVolume" fill="#A5A5A5" radius={[5, 5, 0, 0]} />
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

          {tab === "club" && (
            <>
              <Section
                title={isFr ? "Club Excellence — classement de la saison" : "Club Excellence — season standings"}
                right={<span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{data.season.current.start} → {data.season.current.end}</span>}
              >
                <Table
                  head={["#", isFr ? "Courtier" : "Broker", "Volume", isFr ? "Doss." : "Deals", "Commission", isFr ? "Doss. moy." : "Avg deal", "BPS", "YoY vol."]}
                  rows={data.club.map((c: any) => [
                    c.isMe ? <span key="r" className="inline-flex items-center gap-1" style={{ fontWeight: 800 }}><Trophy className="w-3 h-3" style={{ color: "#FFC000" }} />{c.rank}</span> : c.rank,
                    <span key="n" style={{ fontWeight: c.isMe ? 800 : 500, color: c.isMe ? "var(--pp-brand-accent-2)" : undefined }}>{c.broker}</span>,
                    fmtMoney(c.volume), fmtNum(c.deals), fmtMoney(c.commission), fmtMoney(c.avgDeal), fmtBps(c.bps),
                    <Delta key="d" value={c.volumeYoy} />,
                  ])}
                />
              </Section>
              <Section title={isFr ? "Ma saison mois par mois (août → juillet)" : "My season month by month (Aug → Jul)"}>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={data.clubMonthly.map((m: any) => ({ name: `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`, ...m }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                      <Bar name="Volume" dataKey="volume" fill="#8B5CF6" radius={[5, 5, 0, 0]} />
                      <Line name="Commission" dataKey="commission" stroke="#FFC000" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              {Array.isArray(data.seasons) && (
                <Section title={isFr ? "Saisons Club Excellence (4 dernières)" : "Club Excellence seasons (last 4)"}>
                  <Table
                    head={[isFr ? "Saison" : "Season", "Volume", isFr ? "Doss." : "Deals", "Commission", isFr ? "Doss. moy." : "Avg deal", "BPS", "YoY vol.", "YoY doss.", "YoY comm."]}
                    rows={data.seasons.map((s2: any) => [
                      <span key="l" style={{ fontWeight: 700 }}>{s2.label}</span>,
                      fmtMoney(s2.volume), fmtNum(s2.deals), fmtMoney(s2.commission), fmtMoney(s2.avgDeal), fmtBps(s2.bps),
                      <Delta key="a" value={s2.volumeYoy} />, <Delta key="b" value={s2.dealYoy} />, <Delta key="c" value={s2.commissionYoy} />,
                    ])}
                  />
                  <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
                    {data.seasons.map((s2: any) => (
                      <div key={s2.label} className="pp-card" style={{ padding: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{s2.label}</div>
                        <div style={{ height: 160 }}>
                          <ResponsiveContainer>
                            <ComposedChart data={s2.monthly.map((m: any) => ({ name: MONTHS[m.month - 1], ...m }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--pp-text-muted)" }} />
                              <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(Number(v)), n]} />
                              <Bar name="Volume" dataKey="volume" fill="#4472C4" radius={[4, 4, 0, 0]} />
                              <Line name="Commission" dataKey="commission" stroke="#FFC000" strokeWidth={2} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {Array.isArray(data.reconciliation?.checks) && (
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

          {Array.isArray(data.calcNotes) && (
            <Section title={isFr ? "Notes de calcul" : "Calculation notes"}>
              <ul style={{ fontSize: 12, color: "var(--pp-text-secondary)", lineHeight: 1.6, paddingLeft: 16, listStyle: "disc" }}>
                {data.calcNotes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function pctDelta(cy: number, py: number): number | string {
  if (!py) return cy ? "New" : "—";
  return (cy - py) / py;
}
