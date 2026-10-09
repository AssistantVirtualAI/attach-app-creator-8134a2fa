// Vue par courtier : chiffre d'affaires, volume et dossiers par mois, avec
// comparaison au mois précédent.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, Download, TrendingUp, TrendingDown, Minus, AlertTriangle, BarChart3, BriefcaseBusiness, Users, WalletCards, Landmark, CalendarDays } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PAPage, PAPageHeader, PACard, PATable, PAToolbar, PAStats, PAStat } from "@/components/planipret/admin/PAPageShell";

type Month = { month: number; volume: number; deals: number; commission: number };
type Broker = { id: string; name: string };
type ViewMode = "broker" | "team";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const cad = (n: number) => n.toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const compactCad = (n: number) => new Intl.NumberFormat("fr-CA", { notation: "compact", style: "currency", currency: "CAD", maximumFractionDigits: 1 }).format(n || 0);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="text-muted-foreground text-xs">—</span>;
  if (!prev) return <span className="text-xs text-emerald-600">Nouveau</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const Icon = pct > 0.5 ? TrendingUp : pct < -0.5 ? TrendingDown : Minus;
  const color = pct > 0.5 ? "text-emerald-600" : pct < -0.5 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3 w-3" />{pct >= 0 ? "+" : ""}{pct.toFixed(1)} %
    </span>
  );
}

export default function PABrokerCommissions() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [broker, setBroker] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("broker");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [monthly, setMonthly] = useState<Month[]>([]);
  const [monthlyPy, setMonthlyPy] = useState<Month[]>([]);
  const [totals, setTotals] = useState<{ volume: number; deals: number; commission: number } | null>(null);
  const [totalsPy, setTotalsPy] = useState<{ volume: number; deals: number; commission: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("planipret_profiles")
        .select("user_id, full_name")
        .not("user_id", "is", null)
        .order("full_name");
      const list = (data ?? [])
        .filter((p: any) => p.user_id)
        .map((p: any) => ({ id: p.user_id as string, name: (p.full_name as string) ?? p.user_id }));
      setBrokers(list);
      if (list.length && !broker) setBroker(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!broker) return;
    setLoading(true);
    setError(null);
    const [cur, py] = await Promise.all([
      supabase.functions.invoke("pp-commission-audit", { body: { year, broker_user_id: broker } }),
      supabase.functions.invoke("pp-commission-audit", { body: { year: year - 1, broker_user_id: broker } }),
    ]);
    if (cur.error || !(cur.data as any)?.ok) {
      setError("Impossible de charger les chiffres de ce courtier.");
      setMonthly([]); setTotals(null); setMonthlyPy([]); setTotalsPy(null);
    } else {
      setMonthly((cur.data as any).monthly ?? []);
      setTotals((cur.data as any).totals ?? null);
      const pyOk = !py.error && (py.data as any)?.ok;
      setMonthlyPy(pyOk ? ((py.data as any).monthly ?? []) : []);
      setTotalsPy(pyOk ? ((py.data as any).totals ?? null) : null);
    }
    setLoading(false);
  }, [broker, year]);

  useEffect(() => { void load(); }, [load]);

  const brokerName = useMemo(() => brokers.find((b) => b.id === broker)?.name ?? "", [brokers, broker]);

  const chartData = useMemo(() => monthly.map((m) => {
    const prev = monthlyPy.find((x) => x.month === m.month);
    return {
      name: MONTHS[m.month - 1].slice(0, 3),
      commission: m.commission,
      commissionPy: prev?.commission ?? 0,
      volume: m.volume,
      volumePy: prev?.volume ?? 0,
      deals: m.deals,
      dealsPy: prev?.deals ?? 0,
    };
  }), [monthly, monthlyPy]);

  const averageCommission = totals?.deals ? totals.commission / totals.deals : 0;

  const pyOf = (month: number) => monthlyPy.find((x) => x.month === month) ?? null;

  const exportCsv = () => {
    const head = [
      "Mois",
      `Chiffre d'affaires ${year}`, `Chiffre d'affaires ${year - 1}`, "Écart % (a/a)",
      `Volume ${year}`, `Volume ${year - 1}`,
      `Dossiers ${year}`, `Dossiers ${year - 1}`,
    ];
    const body = monthly.map((m) => {
      const prev = pyOf(m.month);
      const pct = prev && prev.commission ? ((m.commission - prev.commission) / Math.abs(prev.commission)) * 100 : "";
      return [
        MONTHS[m.month - 1],
        m.commission, prev?.commission ?? 0, pct === "" ? "" : `${pct.toFixed(1)} %`,
        m.volume, prev?.volume ?? 0,
        m.deals, prev?.deals ?? 0,
      ];
    });
    const csv = [head, ...body].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `commissions-${brokerName || "courtier"}-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<BarChart3 className="h-[18px] w-[18px]" />}
        title="Commissions par courtier"
        subtitle="Chiffre d'affaires, volume et nombre de dossiers mois par mois, comparés au même mois de l'année précédente."
      />

      <PAToolbar>
        <label className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--pp-text-secondary)" }}>
          <Users className="h-4 w-4" /> Courtier
          <select aria-label="Courtier" value={broker} onChange={(e) => setBroker(e.target.value)}>
            {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--pp-text-secondary)" }}>
          <CalendarDays className="h-4 w-4" /> Année
          <select aria-label="Année" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <div className="inline-flex rounded-lg p-1" style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border)" }}>
          {(["broker", "team"] as const).map((mode) => (
            <Button key={mode} type="button" variant="ghost" size="sm" onClick={() => setViewMode(mode)}
              className="h-7 px-3 text-xs"
              style={viewMode === mode ? { background: "var(--pp-brand-accent-2)", color: "var(--primary-foreground)" } : { color: "var(--pp-text-secondary)" }}>
              {mode === "broker" ? "Courtier" : "Son équipe"}
            </Button>
          ))}
        </div>
        {viewMode === "team" && (
          <select aria-label="Membre de l’équipe" value={teamMembers[0] ?? ""} onChange={(e) => setTeamMembers(e.target.value ? [e.target.value] : [])}>
            <option value="">Toute l’équipe</option>
            {brokers.filter((b) => b.id !== broker).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!monthly.length}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
        </div>
      </PAToolbar>

      {error && (
        <PACard><div className="text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div></PACard>
      )}

      {totals && (
        <PAStats>
          <PAStat icon={<WalletCards className="h-4 w-4" />} label={`Chiffre d'affaires ${year}`} value={cad(totals.commission)} hint={<>{year - 1} : {cad(totalsPy?.commission ?? 0)} · <Delta cur={totals.commission} prev={totalsPy?.commission ?? 0} /></>} />
          <PAStat icon={<Landmark className="h-4 w-4" />} label="Volume de prêts" value={cad(totals.volume)} hint={<>{year - 1} : {cad(totalsPy?.volume ?? 0)} · <Delta cur={totals.volume} prev={totalsPy?.volume ?? 0} /></>} />
          <PAStat icon={<BriefcaseBusiness className="h-4 w-4" />} label="Dossiers financés" value={totals.deals.toLocaleString("fr-CA")} hint={<>{year - 1} : {totalsPy?.deals ?? 0} · <Delta cur={totals.deals} prev={totalsPy?.deals ?? 0} /></>} />
          <PAStat icon={<TrendingUp className="h-4 w-4" />} label="Commission moyenne" value={cad(averageCommission)} hint="Par dossier financé" />
        </PAStats>
      )}

      {totals && chartData.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <PACard title="Commissions mensuelles" subtitle={`${brokerName} · ${year} comparé à ${year - 1}`} icon={<WalletCards className="h-4 w-4" />}>
            <ResponsiveContainer width="100%" height={285}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--pp-bg-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--pp-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => compactCad(Number(v))} tick={{ fill: "var(--pp-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={68} />
                <Tooltip formatter={(v) => cad(Number(v))} contentStyle={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="commission" name={String(year)} fill="var(--pp-brand-accent-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="commissionPy" name={String(year - 1)} fill="var(--pp-warning)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </PACard>
          <PACard title="Volume et dossiers" subtitle="Progression mensuelle des prêts financés" icon={<TrendingUp className="h-4 w-4" />}>
            <ResponsiveContainer width="100%" height={285}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--pp-bg-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--pp-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="volume" tickFormatter={(v) => compactCad(Number(v))} tick={{ fill: "var(--pp-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={68} />
                <YAxis yAxisId="deals" orientation="right" allowDecimals={false} tick={{ fill: "var(--pp-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v, name) => name === "Dossiers" ? Number(v).toLocaleString("fr-CA") : cad(Number(v))} contentStyle={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="volume" dataKey="volume" name="Volume" fill="var(--pp-success)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="deals" type="monotone" dataKey="deals" name="Dossiers" stroke="var(--pp-agent)" strokeWidth={3} dot={{ r: 3 }} />
              </BarChart>
            </ResponsiveContainer>
          </PACard>
        </div>
      )}

      <PACard title={`${brokerName} — ${year} vs ${year - 1}`} subtitle="Détail mensuel complet" icon={<BarChart3 className="h-4 w-4" />} padded={false}>
          <PATable>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-2">Mois</th>
                <th className="text-right">CA {year}</th>
                <th className="text-right pl-3">CA {year - 1}</th>
                <th className="text-right pl-3">Écart</th>
                <th className="text-right pl-3">Volume {year}</th>
                <th className="text-right pl-3">Volume {year - 1}</th>
                <th className="text-right pl-3">Écart</th>
                <th className="text-right pl-3">Dossiers {year}</th>
                <th className="text-right pl-3">Dossiers {year - 1}</th>
                <th className="text-right pl-3">Écart</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const prev = pyOf(m.month);
                return (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-1.5">{MONTHS[m.month - 1]}</td>
                    <td className="text-right">{cad(m.commission)}</td>
                    <td className="text-right pl-3 text-muted-foreground">{cad(prev?.commission ?? 0)}</td>
                    <td className="text-right pl-3"><Delta cur={m.commission} prev={prev?.commission ?? 0} /></td>
                    <td className="text-right pl-3">{cad(m.volume)}</td>
                    <td className="text-right pl-3 text-muted-foreground">{cad(prev?.volume ?? 0)}</td>
                    <td className="text-right pl-3"><Delta cur={m.volume} prev={prev?.volume ?? 0} /></td>
                    <td className="text-right pl-3">{m.deals}</td>
                    <td className="text-right pl-3 text-muted-foreground">{prev?.deals ?? 0}</td>
                    <td className="text-right pl-3"><Delta cur={m.deals} prev={prev?.deals ?? 0} /></td>
                  </tr>
                );
              })}
            </tbody>
          </PATable>
          {!loading && !monthly.length && <p className="text-sm text-muted-foreground pt-3">Aucune donnée pour ce courtier.</p>}
      </PACard>
    </PAPage>
  );
}
