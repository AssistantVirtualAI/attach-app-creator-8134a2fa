import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { Download, LayoutGrid, Table2, Search, RefreshCw } from "lucide-react";
import {
  type CommissionRow, type CommissionFilters, emptyFilters, fetchCommissionRows,
  aggregate, applyFilters, brokerNames, lenderNames, globalTotals, kpiOf,
  fmtMoney, fmtNum, fmtPct, fmtBps, fmtCompact, toCsv, SECTION_LABELS, CHART_COLORS,
} from "@/lib/planipret/commissionStats";

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

function Kpi({ label, value, sub, yoy }: { label: string; value: string; sub?: string; yoy?: number | null }) {
  const up = (yoy ?? 0) >= 0;
  return (
    <div className="pp-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--pp-text-faint)" }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 700, color: "var(--pp-text-primary)", marginTop: 2 }}>{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {sub && <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{sub}</span>}
        {yoy != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: up ? "#00D4AA" : "#E84C4C" }}>
            {up ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}%
          </span>
        )}
      </div>
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
    return <div className="pp-card" style={{ padding: 24, color: "var(--pp-text-muted)" }}>{T(lang, "Chargement des statistiques…", "Loading statistics…")}</div>;
  }
  if (err) {
    return <div className="pp-card" style={{ padding: 24, color: "#E84C4C" }}>{err}</div>;
  }
  if (!rows.length) {
    return (
      <div className="pp-card" style={{ padding: 24, color: "var(--pp-text-muted)" }}>
        {T(lang, "Aucune donnée de commission disponible pour ce compte.", "No commission data available for this account.")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Global overview strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label={T(lang, "Volume", "Volume")} value={fmtMoney(totals.volume)} sub={`PY ${fmtMoney(totals.py_volume)}`} yoy={totals.volumeYoy} />
        <Kpi label={T(lang, "Transactions", "Deals")} value={fmtNum(totals.deals)} sub={`PY ${fmtNum(totals.py_deals)}`} yoy={totals.dealsYoy} />
        <Kpi label="Commission" value={fmtMoney(totals.commission)} sub={`PY ${fmtMoney(totals.py_commission)}`} yoy={totals.commissionYoy} />
        <Kpi label={T(lang, "Volume moyen / dossier", "Avg deal size")} value={fmtMoney(totals.avgDeal)} />
        <Kpi label={T(lang, "Commission moy. / dossier", "Avg comm. / deal")} value={fmtMoney(totals.avgCommission)} />
        <Kpi label="BPS" value={fmtBps(totals.bps)} sub={`PY ${fmtBps(totals.pyBps)}`} />
      </div>

      {/* Filters */}
      <div className="pp-card" style={{ padding: 14 }}>
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
        <div className="pp-card xl:col-span-2" style={{ padding: 16 }}>
          <h3 className="pp-heading mb-2" style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, "Volume par prêteur (CY vs PY)", "Volume by lender (CY vs PY)")}</h3>
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
        </div>

        <div className="pp-card" style={{ padding: 16 }}>
          <h3 className="pp-heading mb-2" style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, "Commission par type", "Commission by type")}</h3>
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
        </div>

        <div className="pp-card xl:col-span-2" style={{ padding: 16 }}>
          <h3 className="pp-heading mb-2" style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, "Évolution trimestrielle", "Quarterly trend")}</h3>
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
        </div>

        <div className="pp-card" style={{ padding: 16 }}>
          <h3 className="pp-heading mb-2" style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, "Mix produit", "Product mix")}</h3>
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
        </div>
      </div>

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
    <div className="pp-card" style={{ padding: 16 }}>
      <h3 className="pp-heading mb-3" style={{ fontSize: 13, fontWeight: 600 }}>{title}</h3>
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
            {rows.map((r) => (
              <tr key={r.key ?? r.id} style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                <td className="py-1.5" style={{ color: "var(--pp-text-primary)" }}>{r.dimension}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{money ? fmtMoney(r.cy_volume) : fmtNum(r.cy_volume)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>{r.py_volume ? fmtMoney(r.py_volume) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-muted)" }}>{fmtNum(r.cy_deals)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "#00D4AA" }}>{r.cy_commission ? fmtMoney(r.cy_commission) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--pp-text-faint)" }}>
                  {totalVol ? fmtPct((Number(r.cy_volume || 0) / totalVol) * 100) : (r.extra?.pct != null ? fmtPct(r.extra.pct) : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
            <div key={sec} className="pp-card flex-shrink-0" style={{ padding: 12, width: 260 }}>
              <div className="flex items-center justify-between mb-2">
                <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-primary)" }}>{SECTION_LABELS[sec]?.[lang] ?? sec}</h4>
                <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {items.map((r: any) => (
                  <div key={r.key ?? r.id} className="rounded-lg p-2.5"
                    style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }}>
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
