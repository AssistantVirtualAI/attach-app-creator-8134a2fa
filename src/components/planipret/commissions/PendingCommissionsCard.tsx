// Commissions en attente — même passerelle, même portée et même mémoire
// hors-ligne que les commissions déposées (action `pending`).
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Hourglass,
  Landmark,
  Search,
  Users,
  WalletCards,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { readStatsCache, statsCacheKey, writeStatsCache, isStatsCacheFresh } from "@/lib/planipret/commissionsCache";
import { ppEdgeInvoke } from "@/lib/planipret/ppEdge";

type CommissionType = { type: string; label: string; amount: number };
type BrokerRow = { users_id: number; name: string; amount: number; files: number; volume: number };
type SortKey = "amount" | "name" | "files" | "volume";

type Summary = {
  total_commission: number;
  deposit_count: number;
  deal_count?: number;
  total_loan_volume: number;
  by_date?: { date: string; amount: number; count: number }[];
  truncated?: boolean;
  official_total?: number | null;
  official_by_type?: CommissionType[] | null;
};

const cad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

const compactCad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

const yearRange = () => {
  const y = new Date().getFullYear();
  return { date_from: `${y}-01-01`, date_to: `${y}-12-31` };
};

function monthLabel(value: string, fr: boolean) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat(fr ? "fr-CA" : "en-CA", { month: "short" }).format(new Date(year, month - 1, 1)).replace(".", "");
}

function PendingTooltip({ active, payload, label, fr }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 shadow-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
      <div className="text-[11px] mb-0.5" style={{ color: "var(--pp-text-muted)" }}>{label}</div>
      <div className="text-[13px] font-bold" style={{ color: "var(--pp-warning)" }}>{cad(Number(payload[0]?.value ?? 0))}</div>
      {payload[0]?.payload?.files > 0 && (
        <div className="text-[11px] mt-0.5" style={{ color: "var(--pp-text-secondary)" }}>
          {payload[0].payload.files} {fr ? "dossiers" : "files"}
        </div>
      )}
    </div>
  );
}

export default function PendingCommissionsCard({ lang = "fr", filters, cacheScope = "default", refreshToken = 0 }: {
  lang?: "fr" | "en";
  filters?: { date_from?: string; date_to?: string; users_id?: string; financial_inst_id?: string };
  cacheScope?: string;
  refreshToken?: number;
}) {
  const fr = lang !== "en";
  const [agent, setAgent] = useState("");
  const [brokers, setBrokers] = useState<BrokerRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("amount");
  const f = useMemo(() => {
    const base = filters?.date_from && filters?.date_to ? { date_from: filters.date_from, date_to: filters.date_to } : yearRange();
    return {
      ...base,
      ...((agent || filters?.users_id) ? { users_id: agent || filters?.users_id } : {}),
      ...(filters?.financial_inst_id ? { financial_inst_id: filters.financial_inst_id } : {}),
    };
  }, [filters?.date_from, filters?.date_to, filters?.users_id, filters?.financial_inst_id, agent]);
  const cacheRole = cacheScope === "admin" || cacheScope === "default" ? "admin" : "broker";
  const key = statsCacheKey(cacheRole, ["pending", cacheScope, f.date_from, f.date_to, f.users_id ?? "", f.financial_inst_id ?? ""]);
  const [summary, setSummary] = useState<Summary | null>(() => ((readStatsCache(key)?.value as any)?.summary as Summary) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readStatsCache(key);
    if (cached?.value) {
      setSummary((cached.value as any).summary ?? null);
      if (!agent) setBrokers((cached.value as any).brokers ?? null);
    }
    if (refreshToken === 0 && isStatsCacheFresh(cached)) return;
    setLoading(!cached?.value);
    setError(null);
    (async () => {
      const r = await ppEdgeInvoke("planipret-commission-reports", { action: "pending", filters: f }, { retries: 1, timeoutMs: 15_000 });
      if (cancelled) return;
      const d = r.data as any;
      if (r.error || !d || d.success === false || d.ok !== true) {
        setError(d?.message ?? (fr ? "Commissions en attente indisponibles pour le moment." : "Pending commissions unavailable right now."));
        return;
      }
      setSummary(d.summary);
      if (!agent) setBrokers(Array.isArray(d.brokers) ? d.brokers : null);
      writeStatsCache(key, { summary: d.summary, brokers: d.brokers ?? null });
    })()
      .catch(() => { if (!cancelled) setError(fr ? "Commissions en attente indisponibles pour le moment." : "Pending commissions unavailable right now."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshToken]);

  const months = useMemo(() => {
    const values = new Map<string, { amount: number; files: number }>();
    for (const row of summary?.by_date ?? []) {
      const month = String(row.date).slice(0, 7);
      const previous = values.get(month) ?? { amount: 0, files: 0 };
      values.set(month, { amount: previous.amount + Number(row.amount || 0), files: previous.files + Number(row.count || 0) });
    }
    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({ month, label: monthLabel(month, fr), amount: Math.round(values.amount), files: values.files }));
  }, [summary, fr]);

  const types = useMemo(() => (summary?.official_by_type ?? []).filter((item) => Number(item.amount) > 0), [summary]);
  const officialTotal = Number(summary?.official_total ?? summary?.total_commission ?? 0);
  const dealCount = Number(summary?.deal_count ?? summary?.deposit_count ?? 0);
  const selectedBroker = brokers?.find((broker) => String(broker.users_id) === agent) ?? null;
  const isAdminView = Boolean(brokers?.length);
  const filteredBrokers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(fr ? "fr-CA" : "en-CA");
    return [...(brokers ?? [])]
      .filter((broker) => !query || broker.name.toLocaleLowerCase(fr ? "fr-CA" : "en-CA").includes(query))
      .sort((a, b) => sort === "name"
        ? a.name.localeCompare(b.name, fr ? "fr" : "en")
        : Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
  }, [brokers, search, sort, fr]);

  const rangeLabel = `${new Intl.DateTimeFormat(fr ? "fr-CA" : "en-CA", { month: "short", year: "numeric" }).format(new Date(`${f.date_from}T12:00:00`))} – ${new Intl.DateTimeFormat(fr ? "fr-CA" : "en-CA", { month: "short", year: "numeric" }).format(new Date(`${f.date_to}T12:00:00`))}`;

  if (loading && !summary) {
    return (
      <section className="rounded-lg p-4 mb-3" aria-busy="true" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)" }}>
        <div className="h-5 w-52 rounded animate-pulse mb-4" style={{ background: "var(--pp-bg-elevated)" }} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-lg animate-pulse" style={{ background: "var(--pp-bg-elevated)" }} />)}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg mb-4 overflow-hidden" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)" }}>
      <header className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0" style={{ color: "var(--pp-warning)", background: "color-mix(in srgb, var(--pp-warning) 12%, transparent)" }}>
              <Hourglass className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] sm:text-[17px] font-bold leading-tight truncate" style={{ color: "var(--pp-text-primary)" }}>
                {selectedBroker?.name ?? (fr ? "Commissions en attente" : "Pending commissions")}
              </h3>
              <p className="text-[11.5px] mt-0.5" style={{ color: "var(--pp-text-muted)" }}>
                {selectedBroker ? (fr ? "Vue détaillée du courtier" : "Broker detail") : rangeLabel}
              </p>
            </div>
          </div>
        </div>
        {selectedBroker && (
          <Button variant="outline" size="sm" onClick={() => setAgent("")} className="h-9 self-start gap-1.5" style={{ borderColor: "var(--pp-bg-border-2)", color: "var(--pp-text-secondary)", background: "var(--pp-bg-elevated)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />
            {fr ? "Tous les courtiers" : "All brokers"}
          </Button>
        )}
      </header>

      {error && (
        <div role="status" className="mx-4 mt-4 rounded-lg px-3 py-2 text-[12px]" style={{ color: "var(--pp-warning)", background: "color-mix(in srgb, var(--pp-warning) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--pp-warning) 28%, transparent)" }}>
          {error} {summary ? (fr ? "Les dernières données enregistrées restent affichées." : "The latest saved data remains visible.") : ""}
        </div>
      )}

      {summary ? (
        <div className="p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Kpi icon={<WalletCards className="w-4 h-4" />} label={fr ? "Montant en attente" : "Pending amount"} value={cad(officialTotal)} emphasized />
            <Kpi icon={<BriefcaseBusiness className="w-4 h-4" />} label={fr ? "Dossiers" : "Files"} value={String(dealCount)} />
            <Kpi icon={<Landmark className="w-4 h-4" />} label={fr ? "Volume hypothécaire" : "Mortgage volume"} value={cad(summary.total_loan_volume)} />
            <Kpi icon={<Users className="w-4 h-4" />} label={isAdminView && !selectedBroker ? (fr ? "Courtiers" : "Brokers") : (fr ? "Moyenne par dossier" : "Average per file")} value={isAdminView && !selectedBroker ? String(brokers?.length ?? 0) : cad(dealCount ? officialTotal / dealCount : 0)} />
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.85fr)] gap-3">
            <Panel title={fr ? "Évolution mensuelle" : "Monthly trend"} icon={<CalendarDays className="w-4 h-4" />}>
              {months.length > 0 ? (
                <>
                  <div className="h-[210px] sm:h-[250px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={months} margin={{ top: 10, right: 4, left: -8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="pendingCommissionBars" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--pp-warning)" stopOpacity={1} />
                            <stop offset="100%" stopColor="var(--pp-brand-accent)" stopOpacity={0.72} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 4" stroke="var(--pp-bg-border-2)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} axisLine={false} tickLine={false} width={52} tickFormatter={(value) => compactCad(Number(value)).replace("$", "")} />
                        <Tooltip cursor={{ fill: "var(--pp-bg-elevated)", opacity: 0.45 }} content={<PendingTooltip fr={fr} />} />
                        <Bar dataKey="amount" name={fr ? "En attente" : "Pending"} fill="url(#pendingCommissionBars)" radius={[5, 5, 0, 0]} maxBarSize={42} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[10.5px] mt-1" style={{ color: "var(--pp-text-faint)" }}>
                    {fr ? "Répartition selon la date de clôture des dossiers." : "Distribution based on file closing dates."}
                  </p>
                </>
              ) : <EmptyMessage fr={fr} />}
            </Panel>

            <Panel title={fr ? "Répartition" : "Breakdown"} icon={<WalletCards className="w-4 h-4" />}>
              {types.length > 0 ? (
                <div className="space-y-3">
                  {types.map((item) => {
                    const percent = officialTotal > 0 ? Math.round((Number(item.amount) / officialTotal) * 100) : 0;
                    return (
                      <div key={item.type}>
                        <div className="flex items-baseline justify-between gap-3 mb-1.5">
                          <span className="text-[12px] font-medium truncate" style={{ color: "var(--pp-text-secondary)" }}>{item.label}</span>
                          <span className="text-[12px] font-bold shrink-0" style={{ color: "var(--pp-text-primary)" }}>{cad(item.amount)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: "var(--pp-bg-border)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, percent)}%`, background: "var(--pp-warning)" }} />
                          </div>
                          <span className="text-[10.5px] w-8 text-right" style={{ color: "var(--pp-text-muted)" }}>{percent}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyMessage fr={fr} />}
            </Panel>
          </div>

          {!selectedBroker && brokers && brokers.length > 0 ? (
            <Panel title={fr ? "Commissions par courtier" : "Commissions by broker"} icon={<Users className="w-4 h-4" />}>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <label className="relative flex-1">
                  <span className="sr-only">{fr ? "Rechercher un courtier" : "Search for a broker"}</span>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--pp-text-muted)" }} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={fr ? "Rechercher un courtier" : "Search brokers"} className="w-full h-10 pl-9 pr-3 rounded-lg text-[13px] outline-none" style={{ background: "var(--pp-bg-surface)", color: "var(--pp-text-primary)", border: "1px solid var(--pp-bg-border-2)" }} />
                </label>
                <label className="relative sm:w-48">
                  <span className="sr-only">{fr ? "Trier les courtiers" : "Sort brokers"}</span>
                  <ArrowDownAZ className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--pp-text-muted)" }} />
                  <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="w-full h-10 pl-9 pr-3 rounded-lg text-[13px] outline-none appearance-none" style={{ background: "var(--pp-bg-surface)", color: "var(--pp-text-primary)", border: "1px solid var(--pp-bg-border-2)" }}>
                    <option value="amount">{fr ? "Montant décroissant" : "Highest amount"}</option>
                    <option value="name">{fr ? "Nom A–Z" : "Name A–Z"}</option>
                    <option value="files">{fr ? "Nombre de dossiers" : "File count"}</option>
                    <option value="volume">{fr ? "Volume hypothécaire" : "Mortgage volume"}</option>
                  </select>
                </label>
              </div>

              <div className="hidden md:block overflow-x-auto rounded-lg" style={{ border: "1px solid var(--pp-bg-border)" }}>
                <table className="w-full min-w-[680px] text-[12px]">
                  <thead style={{ background: "var(--pp-bg-deep)", color: "var(--pp-text-muted)" }}>
                    <tr>
                      <th className="w-12 text-center py-3 font-semibold">#</th>
                      <th className="text-left py-3 font-semibold">{fr ? "Courtier" : "Broker"}</th>
                      <th className="text-right py-3 font-semibold">{fr ? "En attente" : "Pending"}</th>
                      <th className="text-right py-3 font-semibold">{fr ? "Dossiers" : "Files"}</th>
                      <th className="text-right py-3 font-semibold">Volume</th>
                      <th className="text-right py-3 pr-4 font-semibold">{fr ? "Part" : "Share"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBrokers.map((broker, index) => <BrokerTableRow key={broker.users_id} broker={broker} rank={index + 1} total={officialTotal} onSelect={() => setAgent(String(broker.users_id))} />)}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-2">
                {filteredBrokers.map((broker, index) => <BrokerMobileRow key={broker.users_id} broker={broker} rank={index + 1} total={officialTotal} onSelect={() => setAgent(String(broker.users_id))} fr={fr} />)}
              </div>
              {filteredBrokers.length === 0 && <p className="py-6 text-center text-[12px]" style={{ color: "var(--pp-text-muted)" }}>{fr ? "Aucun courtier trouvé." : "No brokers found."}</p>}
            </Panel>
          ) : months.length > 0 ? (
            <Panel title={fr ? "Détail mensuel" : "Monthly detail"} icon={<CalendarDays className="w-4 h-4" />}>
              <div className="divide-y" style={{ borderColor: "var(--pp-bg-border)" }}>
                {months.map((month) => (
                  <div key={month.month} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-[12px]" style={{ borderColor: "var(--pp-bg-border)" }}>
                    <span className="font-medium capitalize" style={{ color: "var(--pp-text-secondary)" }}>{monthLabel(month.month, fr)} {month.month.slice(0, 4)}</span>
                    <span style={{ color: "var(--pp-text-muted)" }}>{month.files} {fr ? "dossiers" : "files"}</span>
                    <span className="font-bold text-right" style={{ color: "var(--pp-text-primary)" }}>{cad(month.amount)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {summary.truncated && <p className="text-[11px]" style={{ color: "var(--pp-warning)" }}>{fr ? "Résultats partiels : réduisez la période pour obtenir tous les dossiers." : "Partial results: narrow the period to include every file."}</p>}
        </div>
      ) : (
        <div className="p-8"><EmptyMessage fr={fr} /></div>
      )}
    </section>
  );
}

function Kpi({ icon, label, value, emphasized = false }: { icon: React.ReactNode; label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="rounded-lg p-3 min-w-0" style={{ background: emphasized ? "color-mix(in srgb, var(--pp-warning) 9%, var(--pp-bg-elevated))" : "var(--pp-bg-elevated)", border: `1px solid ${emphasized ? "color-mix(in srgb, var(--pp-warning) 30%, var(--pp-bg-border))" : "var(--pp-bg-border)"}` }}>
      <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold uppercase mb-1.5" style={{ color: emphasized ? "var(--pp-warning)" : "var(--pp-text-muted)" }}>
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className="text-[17px] sm:text-[21px] font-bold leading-tight truncate" title={value} style={{ color: "var(--pp-text-primary)" }}>{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3.5 sm:p-4 min-w-0" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)" }}>
      <h4 className="flex items-center gap-2 text-[13px] font-bold mb-3" style={{ color: "var(--pp-text-primary)" }}>
        <span style={{ color: "var(--pp-brand-accent)" }}>{icon}</span>{title}
      </h4>
      {children}
    </div>
  );
}

function EmptyMessage({ fr }: { fr: boolean }) {
  return <p className="text-[12px] text-center py-5" style={{ color: "var(--pp-text-muted)" }}>{fr ? "Aucune commission en attente pour cette période." : "No pending commissions for this period."}</p>;
}

function BrokerTableRow({ broker, rank, total, onSelect }: { broker: BrokerRow; rank: number; total: number; onSelect: () => void }) {
  const share = total > 0 ? Math.round((broker.amount / total) * 100) : 0;
  return (
    <tr onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} role="button" tabIndex={0} className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset" style={{ borderTop: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
      <td className="py-3 text-center"><Rank value={rank} /></td>
      <td className="py-3 font-semibold" style={{ color: "var(--pp-text-primary)" }}>{broker.name}</td>
      <td className="py-3 text-right font-bold" style={{ color: "var(--pp-warning)" }}>{cad(broker.amount)}</td>
      <td className="py-3 text-right">{broker.files}</td>
      <td className="py-3 text-right">{cad(broker.volume)}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center justify-end gap-2"><span>{share}%</span><ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--pp-brand-accent)" }} /></div>
      </td>
    </tr>
  );
}

function BrokerMobileRow({ broker, rank, total, onSelect, fr }: { broker: BrokerRow; rank: number; total: number; onSelect: () => void; fr: boolean }) {
  const share = total > 0 ? Math.round((broker.amount / total) * 100) : 0;
  return (
    <Button variant="ghost" onClick={onSelect} className="h-auto min-h-[72px] w-full justify-start rounded-lg px-3 py-2.5 text-left" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}>
      <Rank value={rank} />
      <div className="ml-2.5 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12.5px] font-bold truncate">{broker.name}</span>
          <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--pp-warning)" }}>{cad(broker.amount)}</span>
        </div>
        <div className="flex items-center justify-between mt-1 text-[10.5px]" style={{ color: "var(--pp-text-muted)" }}>
          <span>{broker.files} {fr ? "dossiers" : "files"} · {compactCad(broker.volume)}</span>
          <span>{share}% <ChevronRight className="inline w-3 h-3" /></span>
        </div>
      </div>
    </Button>
  );
}

function Rank({ value }: { value: number }) {
  return <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[10.5px] font-bold shrink-0" style={{ background: value <= 3 ? "color-mix(in srgb, var(--pp-warning) 16%, transparent)" : "var(--pp-bg-elevated)", color: value <= 3 ? "var(--pp-warning)" : "var(--pp-text-muted)", border: "1px solid var(--pp-bg-border-2)" }}>{value}</span>;
}