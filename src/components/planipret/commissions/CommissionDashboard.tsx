import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { Download, LayoutGrid, Table2, Search, RefreshCw, DollarSign, Briefcase, Wallet, Gauge, TrendingUp, Users, Filter, Trophy, Plus, Pencil, Trash2 } from "lucide-react";
import {
  type CommissionRow, type CommissionFilters, emptyFilters, fetchCommissionRows,
  aggregate, applyFilters, brokerNames, lenderNames, globalTotals, kpiOf,
  fmtMoney, fmtNum, fmtPct, fmtBps, fmtCompact, toCsv, SECTION_LABELS, CHART_COLORS,
  isCommissionEditor, deleteCommissionRow, termLabel,
} from "@/lib/planipret/commissionStats";
import CommissionEntryDialog from "./CommissionEntryDialog";


type Lang = "fr" | "en";
const T = (lang: Lang, fr: string, en: string) => (lang === "en" ? en : fr);

const TooltipDark = ({ active, payload, label, money = true }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--pp-text-primary)" }}>
      {label && <div style={{ color: "var(--pp-text-muted)", marginBottom: 4 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill }} />
          <span>{p.name}: <strong>{money ? fmtMoney(p.value) : fmtNum(p.value)}</strong></span>
        </div>
      ))}
    </div>
  );
};

function Kpi({ label, value, sub, yoy, accent = "#2E9BDC", Icon }: {
  label: string; value: string; sub?: string; yoy?: number | null; accent?: string; Icon?: any;
}) {
  const up = (yoy ?? 0) >= 0;
  return (
    <div
      className="relative overflow-hidden rounded-xl transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        background: `linear-gradient(150deg, ${accent}14 0%, transparent 55%), var(--pp-bg-card, var(--pp-bg-deep))`,
        border: "1px solid var(--pp-bg-border-2)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px -18px rgba(0,0,0,.9)",
        padding: 14,
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent, opacity: .85 }} />
      <div className="flex items-start justify-between gap-2">
        <div style={{ fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--pp-text-faint)" }}>{label}</div>
        {Icon && (
          <span className="rounded-md flex items-center justify-center" style={{ width: 22, height: 22, background: `${accent}1f`, color: accent }}>
            <Icon className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className="tabular-nums" style={{ fontSize: 21, fontWeight: 700, color: "var(--pp-text-primary)", marginTop: 4, letterSpacing: "-.02em" }}>{value}</div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {sub && <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{sub}</span>}
        {yoy != null && (
          <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 700, color: up ? "#00D4AA" : "#E84C4C", background: up ? "rgba(0,212,170,.12)" : "rgba(232,76,76,.12)" }}>
            {up ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, accent = "#2E9BDC", right, children, className = "" }: {
  title: string; subtitle?: string; accent?: string; right?: any; children: any; className?: string;
}) {
  return (
    <div className={`pp-card ${className}`} style={{ padding: 16, position: "relative", overflow: "hidden" }}>
      <span style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: `linear-gradient(90deg, ${accent}, transparent 70%)` }} />
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 700, color: "var(--pp-text-primary)", letterSpacing: "-.01em" }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: accent }} />
            {title}
          </h3>
          {subtitle && <p style={{ fontSize: 10.5, color: "var(--pp-text-faint)", marginTop: 2 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 10, color: "var(--pp-text-faint)", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg px-2 py-1.5 text-[12px]"
        style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)", minWidth: 130 }}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

export default function CommissionDashboard({
  lang = "fr",
  scope = "admin",
  brokerName,
  brokerUserId,
}: {
  lang?: Lang;
  scope?: "admin" | "broker";
  brokerName?: string;
  brokerUserId?: string;
}) {
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<CommissionFilters>({ ...emptyFilters });
  const [view, setView] = useState<"table" | "kanban">("table");
  const [canEdit, setCanEdit] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CommissionRow | null>(null);

  useEffect(() => {
    if (scope !== "admin") { setCanEdit(false); return; }
    void isCommissionEditor().then(setCanEdit).catch(() => setCanEdit(false));
  }, [scope]);


  const load = async () => {
    setLoading(true); setErr(null);
    try {
      setRows(await fetchCommissionRows(scope === "broker" ? { brokerUserId, brokerName } : undefined));
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [scope, brokerName, brokerUserId]);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const totals = useMemo(() => globalTotals(filtered), [filtered]);
  const brokers = useMemo(() => brokerNames(rows), [rows]);
  const lenders = useMemo(() => lenderNames(rows), [rows]);

  const lenderData = useMemo(
    () => aggregate(filtered, "lender").sort((a, b) => b.cy_volume - a.cy_volume).slice(0, 12),
    [filtered],
  );
  const quarterData = useMemo(
    () => aggregate(filtered, "quarter").sort((a, b) => String(a.dimension).localeCompare(String(b.dimension))),
    [filtered],
  );
  const typeData = useMemo(() => aggregate(filtered, "commission_type"), [filtered]);
  const productData = useMemo(() => aggregate(filtered, "product_mix"), [filtered]);
  const termData = useMemo(() => aggregate(filtered, "term_mix"), [filtered]);
  const matrixData = useMemo(() => aggregate(filtered, "matrix", true), [filtered]);
  const activeFilterCount = useMemo(() => {
    let n = 0;
    (["broker", "lender", "quarter", "productType", "term", "commissionType"] as const).forEach((k) => { if (filters[k] !== "all") n++; });
    if (filters.search.trim()) n++;
    return n;
  }, [filters]);

  const leaderboard = useMemo(() => {
    const names = brokerNames(filtered);
    const items = names.map((name) => {
      const br = filtered.filter((r) => r.broker_name === name);
      return {
        name,
        volume: Number(kpiOf(br, "volume")?.cy ?? 0),
        commission: Number(kpiOf(br, "commission")?.cy ?? 0),
        deals: Number(kpiOf(br, "deals")?.cy ?? 0),
        pct: 0,
      };
    }).sort((a, b) => b.volume - a.volume);
    const max = Math.max(1, ...items.map((i) => i.volume));
    return items.map((i) => ({ ...i, pct: Math.max(3, (i.volume / max) * 100) }));
  }, [filtered]);

  const clubData = useMemo(() => filtered.filter((r) => r.section === "club"), [filtered]);
  const teamData = useMemo(() => filtered.filter((r) => r.section === "team"), [filtered]);

  const matrixTypes = Array.from(new Set(matrixData.map((r) => String(r.dimension))));
  const matrixTerms = Array.from(new Set(matrixData.map((r) => String(r.sub_dimension)))).sort();
  const matrixVal = (t: string, term: string) =>
    matrixData.filter((r) => r.dimension === t && String(r.sub_dimension) === term).reduce((s, r) => s + Number(r.cy_volume || 0), 0);
  const matrixMax = Math.max(1, ...matrixData.map((r) => Number(r.cy_volume || 0)));

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `commissions-${scope === "broker" ? brokerName ?? "courtier" : "global"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const set = (k: keyof CommissionFilters, v: any) => setFilters((f) => ({ ...f, [k]: v }));

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl animate-pulse" style={{ height: 92, background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }} />
          ))}
        </div>
        <div className="rounded-xl animate-pulse" style={{ height: 64, background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="rounded-xl animate-pulse xl:col-span-2" style={{ height: 320, background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }} />
          <div className="rounded-xl animate-pulse" style={{ height: 320, background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }} />
        </div>
      </div>
    );
  }
  if (err) {
    return <div className="pp-card" style={{ padding: 24, color: "#E84C4C" }}>{err}</div>;
  }
  if (!rows.length) {
    return (
      <div className="pp-card flex flex-col items-center text-center gap-2" style={{ padding: 40 }}>
        <span className="rounded-xl flex items-center justify-center" style={{ width: 44, height: 44, background: "rgba(46,155,220,.12)", color: "#2E9BDC" }}>
          <TrendingUp className="w-5 h-5" />
        </span>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>
          {T(lang, "Aucune donnée de commission", "No commission data")}
        </p>
        <p style={{ fontSize: 11.5, color: "var(--pp-text-faint)", maxWidth: 380 }}>
          {T(lang, "Les statistiques apparaîtront dès qu'un tableau de bord de commissions sera importé pour ce compte.",
                   "Statistics will appear as soon as a commission dashboard is imported for this account.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Global overview strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi Icon={DollarSign} accent="#2E9BDC" label={T(lang, "Volume", "Volume")} value={fmtMoney(totals.volume)} sub={`PY ${fmtMoney(totals.py_volume)}`} yoy={totals.volumeYoy} />
        <Kpi Icon={Briefcase} accent="#9B7FE8" label={T(lang, "Transactions", "Deals")} value={fmtNum(totals.deals)} sub={`PY ${fmtNum(totals.py_deals)}`} yoy={totals.dealsYoy} />
        <Kpi Icon={Wallet} accent="#00D4AA" label="Commission" value={fmtMoney(totals.commission)} sub={`PY ${fmtMoney(totals.py_commission)}`} yoy={totals.commissionYoy} />
        <Kpi Icon={TrendingUp} accent="#E8A33C" label={T(lang, "Volume moyen / dossier", "Avg deal size")} value={fmtMoney(totals.avgDeal)} />
        <Kpi Icon={Wallet} accent="#4AC9E3" label={T(lang, "Commission moy. / dossier", "Avg comm. / deal")} value={fmtMoney(totals.avgCommission)} />
        <Kpi Icon={Gauge} accent="#E86CB0" label="BPS" value={fmtBps(totals.bps)} sub={`PY ${fmtBps(totals.pyBps)}`} />
      </div>

      {/* Filters */}
      <div className="pp-card sticky top-2 z-20" style={{ padding: 14, backdropFilter: "blur(10px)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="rounded-md flex items-center justify-center" style={{ width: 20, height: 20, background: "rgba(46,155,220,.14)", color: "#2E9BDC" }}>
            <Filter className="w-3 h-3" />
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--pp-text-muted)" }}>
            {T(lang, "Filtres & vues", "Filters & views")}
          </span>
          {activeFilterCount > 0 && (
            <span className="rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 700, background: "rgba(46,155,220,.16)", color: "#2E9BDC" }}>
              {activeFilterCount}
            </span>
          )}
          <span className="ml-auto" style={{ fontSize: 10.5, color: "var(--pp-text-faint)" }}>
            {fmtNum(filtered.length)} {T(lang, "lignes", "rows")} · {totals.brokers} {T(lang, "courtier(s)", "broker(s)")}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {scope === "admin" && (
            <Select label={T(lang, "Courtier", "Broker")} value={filters.broker} onChange={(v) => set("broker", v)}
              options={[{ v: "all", l: T(lang, "Tous les courtiers", "All brokers") }, ...brokers.map((b) => ({ v: b, l: b }))]} />
          )}
          <Select label={T(lang, "Prêteur / banque", "Lender / bank")} value={filters.lender} onChange={(v) => set("lender", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...lenders.map((b) => ({ v: b, l: b }))]} />
          <Select label={T(lang, "Trimestre", "Quarter")} value={filters.quarter} onChange={(v) => set("quarter", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...["Q1", "Q2", "Q3", "Q4"].map((q) => ({ v: q, l: q }))]} />
          <Select label={T(lang, "Type de prêt", "Product type")} value={filters.productType} onChange={(v) => set("productType", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...["Taux Fixe", "Taux Variable", "Marge Hypothécaire"].map((p) => ({ v: p, l: p }))]} />
          <Select label={T(lang, "Terme", "Term")} value={filters.term} onChange={(v) => set("term", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...["0", "1", "2", "3", "4", "5"].map((p) => ({ v: p, l: `${p} ${T(lang, "an(s)", "yr")}` }))]} />
          <Select label={T(lang, "Type commission", "Commission type")} value={filters.commissionType} onChange={(v) => set("commissionType", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...["base", "bonus", "bonus2", "perform"].map((p) => ({ v: p, l: p }))]} />

          <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span style={{ fontSize: 10, color: "var(--pp-text-faint)", textTransform: "uppercase", letterSpacing: ".05em" }}>{T(lang, "Recherche", "Search")}</span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--pp-text-faint)" }} />
              <input value={filters.search} onChange={(e) => set("search", e.target.value)}
                placeholder={T(lang, "Courtier, banque, terme…", "Broker, bank, term…")}
                className="w-full rounded-lg pl-7 pr-2 py-1.5 text-[12px]"
                style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }} />
            </div>
          </label>

          <div className="flex items-center gap-2">
            <button onClick={() => setFilters({ ...emptyFilters })} className="px-2.5 py-1.5 rounded-lg text-[12px]"
              style={{ border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-muted)" }}>
              {T(lang, "Réinitialiser", "Reset")}
            </button>
            <button onClick={() => void load()} className="px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5"
              style={{ border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-muted)" }}>
              <RefreshCw className="w-3.5 h-3.5" /> {T(lang, "Actualiser", "Refresh")}
            </button>
            <button onClick={download} className="px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5 text-white"
              style={{ background: "var(--pp-brand-accent-2)" }}>
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--pp-bg-border-2)" }}>
              <button onClick={() => setView("table")} className="px-2.5 py-1.5 text-[12px] flex items-center gap-1.5"
                style={{ background: view === "table" ? "var(--pp-brand-accent-2)" : "transparent", color: view === "table" ? "#fff" : "var(--pp-text-muted)" }}>
                <Table2 className="w-3.5 h-3.5" /> {T(lang, "Tableau", "Table")}
              </button>
              <button onClick={() => setView("kanban")} className="px-2.5 py-1.5 text-[12px] flex items-center gap-1.5"
                style={{ background: view === "kanban" ? "var(--pp-brand-accent-2)" : "transparent", color: view === "kanban" ? "#fff" : "var(--pp-text-muted)" }}>
                <LayoutGrid className="w-3.5 h-3.5" /> Kanban
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel className="xl:col-span-2" accent="#2E9BDC"
          title={T(lang, "Volume par prêteur", "Volume by lender")}
          subtitle={T(lang, "Année courante vs année précédente — top 12", "Current vs prior year — top 12")}>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={lenderData.map((r) => ({ name: r.dimension, CY: r.cy_volume, PY: r.py_volume, Commission: r.cy_commission }))}
                margin={{ top: 8, right: 8, left: -8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#4A7FA5" fontSize={10} angle={-30} textAnchor="end" interval={0} height={60} />
                <YAxis stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CY" fill="#2E9BDC" radius={[5, 5, 0, 0]} />
                <Bar dataKey="PY" fill="#4A7FA5" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel accent="#00D4AA" title={T(lang, "Commission par type", "Commission by type")}
          subtitle={T(lang, "Base, bonis et performance", "Base, bonus and performance")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={typeData.map((r) => ({ name: r.dimension, value: r.cy_commission }))} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={55} outerRadius={88} paddingAngle={3} stroke="none">
                  {typeData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="xl:col-span-2" accent="#9B7FE8" title={T(lang, "Évolution trimestrielle", "Quarterly trend")}
          subtitle={T(lang, "Volume par trimestre, CY vs PY", "Volume per quarter, CY vs PY")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={quarterData.map((r) => ({ name: r.dimension, CY: r.cy_volume, PY: r.py_volume }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="cyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2E9BDC" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#2E9BDC" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#4A7FA5" fontSize={10} />
                <YAxis stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="CY" stroke="#2E9BDC" fill="url(#cyGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="PY" stroke="#9B7FE8" fill="transparent" strokeWidth={2} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel accent="#E8A33C" title={T(lang, "Mix produit", "Product mix")}
          subtitle={T(lang, "Répartition du volume par type de prêt", "Volume split by product type")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={productData.map((r) => ({ name: r.dimension, Volume: r.cy_volume }))} layout="vertical" margin={{ top: 8, right: 16, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis type="category" dataKey="name" stroke="#4A7FA5" fontSize={10} width={110} />
                <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
                <Bar dataKey="Volume" radius={[0, 6, 6, 0]}>
                  {productData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Leaderboard (admin, multi-broker) */}
      {scope === "admin" && leaderboard.length > 1 && (
        <Panel accent="#E8A33C" title={T(lang, "Classement des courtiers", "Broker leaderboard")}
          subtitle={T(lang, "Volume et commissions par courtier", "Volume and commissions per broker")}
          right={<Trophy className="w-4 h-4" style={{ color: "#E8A33C" }} />}>
          <div className="space-y-2.5">
            {leaderboard.map((b, i) => (
              <div key={b.name} className="flex items-center gap-3">
                <span className="rounded-lg flex items-center justify-center shrink-0" style={{
                  width: 24, height: 24, fontSize: 11, fontWeight: 800,
                  background: i === 0 ? "rgba(232,163,60,.18)" : "var(--pp-bg-deep)",
                  color: i === 0 ? "#E8A33C" : "var(--pp-text-muted)",
                  border: "1px solid var(--pp-bg-border-2)",
                }}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-primary)" }}>{b.name}</span>
                    <span className="tabular-nums shrink-0" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                      {fmtMoney(b.volume)} · <span style={{ color: "#00D4AA" }}>{fmtMoney(b.commission)}</span>
                    </span>
                  </div>
                  <div className="mt-1 rounded-full overflow-hidden" style={{ height: 5, background: "var(--pp-bg-deep)" }}>
                    <div style={{ width: `${b.pct}%`, height: "100%", background: `linear-gradient(90deg, ${CHART_COLORS[i % CHART_COLORS.length]}, ${CHART_COLORS[i % CHART_COLORS.length]}80)` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Views */}
      {view === "table" ? (
        <div className="space-y-4">
          <SectionTable lang={lang} title={SECTION_LABELS.lender[lang]} rows={aggregate(filtered, "lender").sort((a, b) => b.cy_volume - a.cy_volume)} money />
          <SectionTable lang={lang} title={SECTION_LABELS.quarter[lang]} rows={quarterData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.commission_type[lang]} rows={typeData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.product_mix[lang]} rows={productData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.term_mix[lang]} rows={termData} money />

          {/* Matrix heat table */}
          {matrixTypes.length > 0 && (
            <div className="pp-card" style={{ padding: 16 }}>
              <h3 className="pp-heading mb-3" style={{ fontSize: 13, fontWeight: 600 }}>{SECTION_LABELS.matrix[lang]}</h3>
              <div className="pa-scroll overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr style={{ color: "var(--pp-text-faint)" }}>
                      <th className="text-left py-1.5 pr-3">{T(lang, "Type", "Type")}</th>
                      {matrixTerms.map((t) => <th key={t} className="text-right py-1.5 px-2">{t}</th>)}
                      <th className="text-right py-1.5 pl-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixTypes.map((ty) => {
                      const total = matrixTerms.reduce((s, t) => s + matrixVal(ty, t), 0);
                      return (
                        <tr key={ty} style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                          <td className="py-1.5 pr-3" style={{ color: "var(--pp-text-primary)" }}>{ty}</td>
                          {matrixTerms.map((t) => {
                            const v = matrixVal(ty, t);
                            return (
                              <td key={t} className="text-right py-1.5 px-2 tabular-nums"
                                style={{ background: v ? `rgba(46,155,220,${0.08 + 0.5 * (v / matrixMax)})` : "transparent", color: "var(--pp-text-muted)" }}>
                                {v ? fmtMoney(v) : "—"}
                              </td>
                            );
                          })}
                          <td className="text-right py-1.5 pl-2 tabular-nums" style={{ color: "var(--pp-text-primary)", fontWeight: 700 }}>{fmtMoney(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(clubData.length > 0 || teamData.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {clubData.length > 0 && (
                <div className="pp-card" style={{ padding: 16 }}>
                  <h3 className="pp-heading mb-3" style={{ fontSize: 13, fontWeight: 600 }}>{SECTION_LABELS.club[lang]}</h3>
                  <div className="space-y-1.5">
                    {clubData.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-[12px]" style={{ borderTop: "1px solid var(--pp-bg-border-2)", paddingTop: 6 }}>
                        <span style={{ color: "var(--pp-text-muted)" }}>{r.broker_name} · {r.dimension}</span>
                        <span className="tabular-nums" style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>
                          {r.cy_volume ? fmtMoney(r.cy_volume) : (r.extra?.current ?? "—")}
                          {r.extra?.yoy != null && r.extra?.yoy !== "" && <span style={{ color: "#00D4AA", marginLeft: 8 }}>{typeof r.extra.yoy === "number" ? fmtPct(r.extra.yoy) : r.extra.yoy}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {teamData.length > 0 && (
                <div className="pp-card" style={{ padding: 16 }}>
                  <h3 className="pp-heading mb-3" style={{ fontSize: 13, fontWeight: 600 }}>{SECTION_LABELS.team[lang]}</h3>
                  <table className="w-full text-[12px]">
                    <thead><tr style={{ color: "var(--pp-text-faint)" }}>
                      <th className="text-left py-1.5">{T(lang, "Métrique", "Metric")}</th>
                      <th className="text-right py-1.5">{T(lang, "Courtier", "Broker")}</th>
                      <th className="text-right py-1.5">{T(lang, "Équipe", "Team")}</th>
                      <th className="text-right py-1.5">Part</th>
                    </tr></thead>
                    <tbody>
                      {teamData.map((r) => (
                        <tr key={r.id} style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                          <td className="py-1.5" style={{ color: "var(--pp-text-primary)" }}>{r.dimension}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{r.extra?.broker}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{r.extra?.team}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "#00D4AA", fontWeight: 700 }}>{r.extra?.share}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <KanbanView lang={lang} filtered={filtered} />
      )}
    </div>
  );
}

function SectionTable({ lang, title, rows, money }: { lang: Lang; title: string; rows: any[]; money?: boolean }) {
  if (!rows.length) return null;
  const totalVol = rows.reduce((s, r) => s + Number(r.cy_volume || 0), 0);
  return (
    <Panel title={title} accent="#4AC9E3" subtitle={`${rows.length} ${T(lang, "éléments", "items")}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: "var(--pp-text-faint)" }}>
              <th className="text-left py-1.5">{T(lang, "Libellé", "Label")}</th>
              <th className="text-right py-1.5">Volume CY</th>
              <th className="text-right py-1.5">Volume PY</th>
              <th className="text-right py-1.5">{T(lang, "Dossiers", "Deals")}</th>
              <th className="text-right py-1.5">Commission</th>
              <th className="text-right py-1.5">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const share = totalVol ? (Number(r.cy_volume || 0) / totalVol) * 100 : 0;
              return (
              <tr key={r.key ?? r.id} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                <td className="py-2" style={{ color: "var(--pp-text-primary)" }}>
                  <div className="flex items-center gap-2">
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="truncate">{r.dimension}</span>
                  </div>
                  {share > 0 && (
                    <div className="mt-1 rounded-full overflow-hidden" style={{ height: 3, background: "var(--pp-bg-deep)", maxWidth: 220 }}>
                      <div style={{ width: `${share}%`, height: "100%", background: CHART_COLORS[i % CHART_COLORS.length], opacity: .8 }} />
                    </div>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{money ? fmtMoney(r.cy_volume) : fmtNum(r.cy_volume)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>{r.py_volume ? fmtMoney(r.py_volume) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{fmtNum(r.cy_deals)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "#00D4AA" }}>{r.cy_commission ? fmtMoney(r.cy_commission) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>
                  {r.extra?.pct != null ? fmtPct(r.extra.pct)
                    : r.extra?.pct_cy != null ? fmtPct(r.extra.pct_cy)
                    : totalVol ? fmtPct((Number(r.cy_volume || 0) / totalVol) * 100) : "—"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function KanbanView({ lang, filtered }: { lang: Lang; filtered: CommissionRow[] }) {
  const sections = ["lender", "quarter", "commission_type", "product_mix", "term_mix", "club"];
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: "min-content" }}>
        {sections.map((sec) => {
          const items = sec === "club"
            ? filtered.filter((r) => r.section === "club")
            : aggregate(filtered, sec).sort((a, b) => b.cy_volume - a.cy_volume);
          if (!items.length) return null;
          return (
            <div key={sec} className="pp-card flex-shrink-0" style={{ padding: 12, width: 268 }}>
              <div className="flex items-center justify-between mb-2">
                <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-primary)" }}>{SECTION_LABELS[sec]?.[lang] ?? sec}</h4>
                <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {items.map((r: any, idx: number) => (
                  <div key={r.key ?? r.id} className="rounded-lg p-2.5 transition-transform duration-150 hover:-translate-y-0.5"
                    style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)", borderLeft: `3px solid ${CHART_COLORS[idx % CHART_COLORS.length]}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-primary)" }}>{r.dimension}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }} className="tabular-nums">
                        {r.cy_volume ? fmtMoney(r.cy_volume) : (r.extra?.current ?? "—")}
                      </span>
                      {!!r.cy_deals && <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{fmtNum(r.cy_deals)} {T(lang, "dossiers", "deals")}</span>}
                    </div>
                    {!!r.cy_commission && (
                      <div style={{ fontSize: 11, color: "#00D4AA", fontWeight: 600 }} className="tabular-nums mt-0.5">{fmtMoney(r.cy_commission)}</div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--pp-text-faint)", marginTop: 4 }}>{r.broker_name}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
