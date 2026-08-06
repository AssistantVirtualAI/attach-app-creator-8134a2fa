import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
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

function ChartValues({ items, valueKey = "CY", compareKey }: { items: Array<Record<string, any>>; valueKey?: string; compareKey?: string }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
      {items.slice(0, 12).map((item, index) => (
        <div key={`${item.name}-${index}`} className="rounded-lg px-2.5 py-2" style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }}>
          <div className="truncate" style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{item.name}</div>
          <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: CHART_COLORS[index % CHART_COLORS.length] }}>{fmtMoney(item[valueKey])}</div>
          {compareKey && <div className="tabular-nums" style={{ fontSize: 9.5, color: "var(--pp-text-faint)" }}>PY {fmtMoney(item[compareKey])}</div>}
        </div>
      ))}
    </div>
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
  const productTypes = useMemo(() => Array.from(new Set(rows
    .filter((r) => r.section === "product_mix" || r.section === "matrix")
    .map((r) => String(r.dimension ?? "").trim()).filter(Boolean))).sort(), [rows]);
  const commissionTypes = useMemo(() => Array.from(new Set(rows
    .filter((r) => r.section === "commission_type")
    .map((r) => String(r.dimension ?? "").trim()).filter(Boolean))).sort(), [rows]);

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
  const finite = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  };
  const lenderChartData = useMemo(() => lenderData.map((r) => ({
    name: String(r.dimension ?? "—"), CY: finite(r.cy_volume), PY: finite(r.py_volume),
  })), [lenderData]);
  const commissionChartData = useMemo(() => typeData.map((r) => ({
    name: String(r.dimension ?? "—"), CY: finite(r.cy_commission), PY: finite(r.py_commission),
  })), [typeData]);
  const quarterChartData = useMemo(() => quarterData.map((r) => ({
    name: String(r.dimension ?? "—"), CY: finite(r.cy_volume), PY: finite(r.py_volume),
    deals: finite(r.cy_deals), commission: finite(r.cy_commission),
  })), [quarterData]);
  const productChartData = useMemo(() => productData.map((r) => ({
    name: String(r.dimension ?? "—"), Volume: finite(r.cy_volume), Deals: finite(r.cy_deals),
  })), [productData]);
  const termChartData = useMemo(() => termData.map((r) => ({
    name: termLabel(String(r.dimension ?? ""), lang), CY: finite(r.cy_volume), PY: finite(r.py_volume),
  })), [termData, lang]);
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

  const handleDelete = async (r: CommissionRow) => {
    if (!window.confirm(T(lang, `Supprimer cette ligne (${r.dimension ?? r.section}) ?`, `Delete this row (${r.dimension ?? r.section})?`))) return;
    try { await deleteCommissionRow(r.id); await load(); }
    catch (e: any) { setErr(e?.message ?? "Erreur"); }
  };


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
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...productTypes.map((p) => ({ v: p, l: p }))]} />
          <Select label={T(lang, "Terme", "Term")} value={filters.term} onChange={(v) => set("term", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...["0", "1", "2", "3", "4", "5"].map((p) => ({ v: p, l: `${p} ${T(lang, "an(s)", "yr")}` }))]} />
          <Select label={T(lang, "Type commission", "Commission type")} value={filters.commissionType} onChange={(v) => set("commissionType", v)}
            options={[{ v: "all", l: T(lang, "Tous", "All") }, ...commissionTypes.map((p) => ({ v: p, l: p }))]} />

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
            {canEdit && (
              <button onClick={() => { setEditRow(null); setDialogOpen(true); }}
                className="px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5 text-white"
                style={{ background: "#00A37A" }}>
                <Plus className="w-3.5 h-3.5" /> {T(lang, "Ajouter", "Add")}
              </button>
            )}

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
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={lenderChartData}
                margin={{ top: 8, right: 8, left: -8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#4A7FA5" fontSize={10} angle={-30} textAnchor="end" interval={0} height={60} />
                <YAxis stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CY" fill="#2E9BDC" radius={[5, 5, 0, 0]} isAnimationActive={false} minPointSize={2} />
                <Bar dataKey="PY" fill="#4A7FA5" radius={[5, 5, 0, 0]} isAnimationActive={false} minPointSize={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartValues items={lenderChartData} compareKey="PY" />
        </Panel>

        <Panel accent="#00D4AA" title={T(lang, "Commission par type", "Commission by type")}
          subtitle={T(lang, "Base, bonis et performance", "Base, bonus and performance")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie data={commissionChartData.map((r) => ({ name: r.name, value: r.CY }))} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={55} outerRadius={88} paddingAngle={3} stroke="none" isAnimationActive={false}>
                  {commissionChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ChartValues items={commissionChartData} compareKey="PY" />
        </Panel>

        <Panel className="xl:col-span-2" accent="#9B7FE8" title={T(lang, "Évolution trimestrielle", "Quarterly trend")}
          subtitle={T(lang, "Volume par trimestre, CY vs PY", "Volume per quarter, CY vs PY")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={quarterChartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
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
                <Area type="monotone" dataKey="CY" stroke="#2E9BDC" fill="url(#cyGrad)" strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="PY" stroke="#9B7FE8" fill="transparent" strokeWidth={2} strokeDasharray="4 4" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ChartValues items={quarterChartData} compareKey="PY" />
        </Panel>

        <Panel accent="#E8A33C" title={T(lang, "Mix produit", "Product mix")}
          subtitle={T(lang, "Répartition du volume par type de prêt", "Volume split by product type")}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={productChartData} layout="vertical" margin={{ top: 8, right: 16, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis type="category" dataKey="name" stroke="#4A7FA5" fontSize={10} width={110} />
                <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
                <Bar dataKey="Volume" radius={[0, 6, 6, 0]} isAnimationActive={false} minPointSize={2}>
                  {productChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartValues items={productChartData} valueKey="Volume" />
        </Panel>
      </div>

      {/* Supplemental analytics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel accent="#4AC9E3" title={T(lang, "Mix des termes", "Term mix")}
          subtitle={T(lang, "Volume par durée — année courante et précédente", "Volume by term — current and prior year")}>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={termChartData} margin={{ top: 8, right: 8, left: -8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#4A7FA5" fontSize={10} />
                <YAxis stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CY" fill="#4AC9E3" radius={[4, 4, 0, 0]} isAnimationActive={false} minPointSize={2} />
                <Bar dataKey="PY" fill="#4A7FA5" radius={[4, 4, 0, 0]} isAnimationActive={false} minPointSize={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartValues items={termChartData} compareKey="PY" />
        </Panel>

        <Panel accent="#E86CB0" title={T(lang, "Dossiers et commissions", "Deals and commissions")}
          subtitle={T(lang, "Performance trimestrielle combinée", "Combined quarterly performance")}>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={quarterChartData} margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#4A7FA5" fontSize={10} />
                <YAxis yAxisId="money" stroke="#4A7FA5" fontSize={10} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis yAxisId="deals" orientation="right" stroke="#E86CB0" fontSize={10} />
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="money" type="monotone" dataKey="commission" name={T(lang, "Commission", "Commission")} stroke="#00D4AA" strokeWidth={3} dot={{ r: 4 }} isAnimationActive={false} />
                <Line yAxisId="deals" type="monotone" dataKey="deals" name={T(lang, "Dossiers", "Deals")} stroke="#E86CB0" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
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
          <SectionTable lang={lang} title={SECTION_LABELS.productivity[lang]} rows={aggregate(filtered, "productivity").sort((a, b) => b.cy_volume - a.cy_volume)} money />
          <SectionTable lang={lang} title={SECTION_LABELS.lender[lang]} rows={aggregate(filtered, "lender").sort((a, b) => b.cy_volume - a.cy_volume)} money />
          <SectionTable lang={lang} title={SECTION_LABELS.quarter[lang]} rows={quarterData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.commission_type[lang]} rows={typeData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.product_mix[lang]} rows={productData} money />
          <SectionTable lang={lang} title={SECTION_LABELS.term_mix[lang]} rows={termData} money labelFn={(v) => termLabel(String(v), lang)} />

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
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>
                            {r.extra?.broker != null ? (typeof r.extra.broker === "number" ? fmtNum(r.extra.broker) : r.extra.broker) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>
                            {r.extra?.team != null ? (typeof r.extra.team === "number" ? fmtNum(r.extra.team) : r.extra.team) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "#00D4AA", fontWeight: 700 }}>
                            {r.extra?.share != null ? (typeof r.extra.share === "number" ? fmtPct(r.extra.share) : r.extra.share) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {canEdit && (
            <Panel accent="#00D4AA"
              title={T(lang, "Données brutes — saisie manuelle", "Raw data — manual entry")}
              subtitle={T(lang, "Modifier ou supprimer n'importe quelle valeur", "Edit or delete any value")}
              right={
                <button onClick={() => { setEditRow(null); setDialogOpen(true); }}
                  className="px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5 text-white" style={{ background: "#00A37A" }}>
                  <Plus className="w-3.5 h-3.5" /> {T(lang, "Ajouter", "Add")}
                </button>
              }>
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0" style={{ background: "var(--pp-bg-deep)" }}>
                    <tr style={{ color: "var(--pp-text-faint)" }}>
                      <th className="text-left py-1.5 pr-2">{T(lang, "Courtier", "Broker")}</th>
                      <th className="text-left py-1.5 pr-2">Section</th>
                      <th className="text-left py-1.5 pr-2">{T(lang, "Libellé", "Label")}</th>
                      <th className="text-left py-1.5 pr-2">{T(lang, "Sous-lib.", "Sub")}</th>
                      <th className="text-right py-1.5 px-2">Vol. CY</th>
                      <th className="text-right py-1.5 px-2">Vol. PY</th>
                      <th className="text-right py-1.5 px-2">{T(lang, "Doss.", "Deals")}</th>
                      <th className="text-right py-1.5 px-2">Comm. CY</th>
                      <th className="text-right py-1.5 pl-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                        <td className="py-1.5 pr-2" style={{ color: "var(--pp-text-primary)" }}>{r.broker_name}</td>
                        <td className="py-1.5 pr-2" style={{ color: "var(--pp-text-faint)" }}>{SECTION_LABELS[String(r.section)]?.[lang] ?? r.section}</td>
                        <td className="py-1.5 pr-2" style={{ color: "var(--pp-text-muted)" }}>{r.dimension ?? "—"}</td>
                        <td className="py-1.5 pr-2" style={{ color: "var(--pp-text-faint)" }}>{r.sub_dimension ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{r.cy_volume ? fmtMoney(r.cy_volume) : "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>{r.py_volume ? fmtMoney(r.py_volume) : "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{r.cy_deals ? fmtNum(r.cy_deals) : "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "#00D4AA" }}>{r.cy_commission ? fmtMoney(r.cy_commission) : "—"}</td>
                        <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditRow(r); setDialogOpen(true); }} className="p-1 rounded-md" style={{ color: "var(--pp-text-muted)" }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => void handleDelete(r)} className="p-1 rounded-md" style={{ color: "#E84C4C" }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      ) : (
        <KanbanView lang={lang} filtered={filtered} />
      )}

      {canEdit && (
        <CommissionEntryDialog
          lang={lang}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={() => void load()}
          row={editRow}
          brokers={brokers}
          defaultBroker={filters.broker !== "all" ? filters.broker : undefined}
        />
      )}
    </div>
  );
}


function Delta({ cy, py }: { cy: any; py: any }) {
  const c = Number(cy || 0), p = Number(py || 0);
  if (!p) return <span style={{ fontSize: 10.5, color: "var(--pp-text-faint)" }}>—</span>;
  const d = ((c - p) / Math.abs(p)) * 100;
  const up = d >= 0;
  return (
    <span className="rounded-full px-1.5 py-0.5 tabular-nums" style={{
      fontSize: 10, fontWeight: 700,
      color: up ? "#00D4AA" : "#E84C4C",
      background: up ? "rgba(0,212,170,.12)" : "rgba(232,76,76,.12)",
    }}>{up ? "▲" : "▼"} {Math.abs(d).toFixed(1)}%</span>
  );
}

function SectionTable({ lang, title, rows, money, labelFn, accent = "#4AC9E3" }: {
  lang: Lang; title: string; rows: any[]; money?: boolean; labelFn?: (v: any) => string; accent?: string;
}) {
  if (!rows.length) return null;
  const num = (v: any) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
  const totalVol = rows.reduce((s, r) => s + num(r.cy_volume), 0);
  const totalPy = rows.reduce((s, r) => s + num(r.py_volume), 0);
  const totalDeals = rows.reduce((s, r) => s + num(r.cy_deals), 0);
  const totalComm = rows.reduce((s, r) => s + num(r.cy_commission), 0);
  const maxVol = Math.max(1, ...rows.map((r) => num(r.cy_volume)));
  const chartData = rows.slice(0, 14).map((r) => ({
    name: labelFn ? labelFn(r.dimension) : String(r.dimension ?? "—"),
    CY: num(r.cy_volume), PY: num(r.py_volume),
  }));
  const hasChart = chartData.some((d) => d.CY || d.PY);

  return (
    <Panel title={title} accent={accent} subtitle={`${rows.length} ${T(lang, "éléments", "items")} · ${fmtMoney(totalVol)} · ${fmtNum(totalDeals)} ${T(lang, "dossiers", "deals")}`}
      right={
        <div className="hidden sm:flex items-center gap-3">
          <div className="text-right">
            <div style={{ fontSize: 9.5, color: "var(--pp-text-faint)", textTransform: "uppercase", letterSpacing: ".06em" }}>Commission</div>
            <div className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: "#00D4AA" }}>{fmtMoney(totalComm)}</div>
          </div>
          <Delta cy={totalVol} py={totalPy} />
        </div>
      }>
      {hasChart && (
        <div style={{ width: "100%", height: 132, marginBottom: 10 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="#4A7FA5" fontSize={9} tickLine={false} axisLine={false} interval={0} height={26} />
              <YAxis stroke="#4A7FA5" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCompact(v)} width={44} />
              <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
              <Bar dataKey="PY" name="PY" fill="#3A5A78" radius={[3, 3, 0, 0]} isAnimationActive={false} minPointSize={2} />
              <Bar dataKey="CY" name="CY" radius={[3, 3, 0, 0]} isAnimationActive={false} minPointSize={2}>
                {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: "var(--pp-text-faint)" }}>
              <th className="text-left py-1.5 w-8">#</th>
              <th className="text-left py-1.5">{T(lang, "Libellé", "Label")}</th>
              <th className="text-right py-1.5">Volume CY</th>
              <th className="text-right py-1.5">Volume PY</th>
              <th className="text-right py-1.5">YoY</th>
              <th className="text-right py-1.5">{T(lang, "Dossiers", "Deals")}</th>
              <th className="text-right py-1.5">Commission</th>
              <th className="text-right py-1.5">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const share = totalVol ? (num(r.cy_volume) / totalVol) * 100 : 0;
              const bar = (num(r.cy_volume) / maxVol) * 100;
              const color = CHART_COLORS[i % CHART_COLORS.length];
              return (
              <tr key={r.key ?? r.id} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                <td className="py-2 tabular-nums" style={{ color: "var(--pp-text-faint)", fontSize: 10.5 }}>{i + 1}</td>
                <td className="py-2" style={{ color: "var(--pp-text-primary)" }}>
                  <div className="flex items-center gap-2">
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: color }} />
                    <span className="truncate">{labelFn ? labelFn(r.dimension) : r.dimension}</span>
                  </div>
                  {bar > 0 && (
                    <div className="mt-1 rounded-full overflow-hidden" style={{ height: 4, background: "var(--pp-bg-deep)", maxWidth: 220 }}>
                      <div style={{ width: `${Math.max(2, bar)}%`, height: "100%", background: `linear-gradient(90deg, ${color}, ${color}66)` }} />
                    </div>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>{money ? fmtMoney(r.cy_volume) : fmtNum(r.cy_volume)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>{r.py_volume ? fmtMoney(r.py_volume) : "—"}</td>
                <td className="py-1.5 text-right"><Delta cy={r.cy_volume} py={r.py_volume} /></td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{fmtNum(r.cy_deals)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "#00D4AA" }}>{r.cy_commission ? fmtMoney(r.cy_commission) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>
                  {r.extra?.pct != null ? fmtPct(r.extra.pct)
                    : r.extra?.pct_cy != null ? fmtPct(r.extra.pct_cy)
                    : totalVol ? fmtPct(share) : "—"}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--pp-bg-border-2)" }}>
              <td />
              <td className="py-2" style={{ color: "var(--pp-text-primary)", fontWeight: 700 }}>Total</td>
              <td className="py-2 text-right tabular-nums" style={{ color: "var(--pp-text-primary)", fontWeight: 700 }}>{fmtMoney(totalVol)}</td>
              <td className="py-2 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>{totalPy ? fmtMoney(totalPy) : "—"}</td>
              <td className="py-2 text-right"><Delta cy={totalVol} py={totalPy} /></td>
              <td className="py-2 text-right tabular-nums" style={{ color: "var(--pp-text-primary)", fontWeight: 700 }}>{fmtNum(totalDeals)}</td>
              <td className="py-2 text-right tabular-nums" style={{ color: "#00D4AA", fontWeight: 700 }}>{totalComm ? fmtMoney(totalComm) : "—"}</td>
              <td className="py-2 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>100%</td>
            </tr>
          </tfoot>
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
