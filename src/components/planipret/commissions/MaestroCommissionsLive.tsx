import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";

type Period = "month" | "quarter" | "year" | "ytd" | "all";

type Summary = {
  total_commission: number;
  deposit_count: number;
  average_commission: number;
  total_loan_volume: number;
  adjustments: number;
  top_institutions: { institution: string; amount: number; count: number }[];
  by_date: { date: string; amount: number; count: number }[];
  truncated: boolean;
};

type DepositRow = {
  number: string | null;
  institution: string | null;
  amount: string | number | null;
  loan_amt: string | number | null;
  date_trans: string | null;
  commission_type: string | null;
  primary_client_name: string | null;
  agent_name?: string | null;
};

const cad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);
const cad2 = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(n || 0);
const numOf = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function rangeFor(period: Period): { date_from?: string; date_to?: string } {
  if (period === "all") return {};
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (period === "month") d.setDate(1);
  else if (period === "quarter") { d.setMonth(Math.floor(d.getMonth() / 3) * 3); d.setDate(1); }
  else if (period === "year" || period === "ytd") { d.setMonth(0); d.setDate(1); }
  return { date_from: d.toISOString().slice(0, 10), date_to: to };
}


async function callGateway(action: string, payload: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("planipret-commission-reports", {
    body: { action, ...payload },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as any;
}

type AgentAgg = { users_id: number | null; name: string; total: number; count: number; loan_volume: number; average: number };

type ByAgentMeta = {
  truncated?: boolean;
  scanned?: number;
  sources?: { queried: number; failed: number; failures: { broker: string; status: number; message: string }[] };
  scope?: { mode?: string };
};

const PER_PAGE = 25;

/** Live Maestro commission reports for the desktop portal (admin = all brokers, broker = own scope). */
export default function MaestroCommissionsLive({ lang, scope }: { lang: "fr" | "en"; scope: "admin" | "broker" }) {
  const fr = lang === "fr";
  const [period, setPeriod] = useState<Period>("month");
  const [agents, setAgents] = useState<{ users_id: number; name: string }[]>([]);
  const [agentId, setAgentId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [byAgent, setByAgent] = useState<AgentAgg[]>([]);
  const [byAgentMeta, setByAgentMeta] = useState<ByAgentMeta | null>(null);
  const [byAgentPage, setByAgentPage] = useState(1);
  const [byAgentError, setByAgentError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ connected: number; total: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotConnected(false);
    try {
      const range = rangeFor(period);
      const base: Record<string, unknown> = { ...range, commission_type: "base" };
      if (agentId) base.users_id = Number(agentId);
      const wantsByAgent = scope === "admin" && !agentId;
      const [s, d, a] = await Promise.all([
        callGateway("summary", base),
        callGateway("deposits", { ...base, per_page: 50, page: 1, order_by: "date_trans", sort: "desc" }),
        wantsByAgent ? callGateway("by_agent", base) : Promise.resolve(null),
      ]);
      setSummary(s?.summary ?? null);
      setRows(Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.data) ? d.data : []);
      setByAgent(Array.isArray(a?.agents) ? a.agents : []);
      setByAgentMeta(a ? { truncated: a.truncated, scanned: a.scanned, sources: a.sources, scope: a.scope } : null);
      setByAgentPage(1);
      setByAgentError(null);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/maestro_not_connected/i.test(msg)) setNotConnected(true);
      else setError(msg);
      setByAgentError(msg || null);
      setSummary(null); setRows([]); setByAgent([]); setByAgentMeta(null);
    } finally {
      setLoading(false);
    }
  }, [period, agentId, scope]);

  useEffect(() => {
    if (scope !== "admin") return;
    callGateway("agents").then((r) => setAgents(Array.isArray(r?.agents) ? r.agents : [])).catch(() => setAgents([]));
  }, [scope]);


  useEffect(() => { void load(); }, [load]);

  const chart = useMemo(
    () => (summary?.by_date ?? []).map((b) => ({ date: b.date.slice(5), amount: b.amount })),
    [summary],
  );

  const agentName = useMemo(
    () => agents.find((a) => String(a.users_id) === agentId)?.name ?? null,
    [agents, agentId],
  );

  const filterLabel = useMemo(() => {
    const r = rangeFor(period);
    const periodTxt = period === "all"
      ? (fr ? "toutes les périodes" : "all time")
      : `${r.date_from} → ${r.date_to}`;
    const who = agentId
      ? (fr ? `courtier : ${agentName ?? agentId}` : `broker: ${agentName ?? agentId}`)
      : scope === "admin" ? (fr ? "tous les courtiers" : "all brokers") : (fr ? "mon portefeuille" : "my book");
    return fr
      ? `Filtre appliqué — période : ${periodTxt} · ${who} · type : base`
      : `Applied filter — period: ${periodTxt} · ${who} · type: base`;
  }, [period, agentId, agentName, scope, fr]);

  const byAgentTotals = useMemo(() => ({
    brokers: byAgent.length,
    count: byAgent.reduce((s, a) => s + a.count, 0),
    total: byAgent.reduce((s, a) => s + a.total, 0),
    loan_volume: byAgent.reduce((s, a) => s + a.loan_volume, 0),
  }), [byAgent]);

  const byAgentPages = Math.max(1, Math.ceil(byAgent.length / PER_PAGE));
  const pagedAgents = useMemo(
    () => byAgent.slice((byAgentPage - 1) * PER_PAGE, byAgentPage * PER_PAGE),
    [byAgent, byAgentPage],
  );

  const periods: { k: Period; fr: string; en: string }[] = [
    { k: "month", fr: "Mois", en: "Month" },
    { k: "quarter", fr: "Trimestre", en: "Quarter" },
    { k: "year", fr: "Année", en: "Year" },
    { k: "all", fr: "Tout", en: "All time" },
  ];


  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1">
          {periods.map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
              style={{
                background: period === p.k ? "var(--pp-brand-accent, #9B7FE8)" : "transparent",
                color: period === p.k ? "#0A1628" : "var(--pp-text-secondary, #6b7280)",
                borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))",
              }}>{fr ? p.fr : p.en}</button>
          ))}
        </div>

        {scope === "admin" && agents.length > 0 && (
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-xs bg-transparent"
            style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
            <option value="">{fr ? "Tous les courtiers" : "All brokers"}</option>
            {agents.map((a) => <option key={a.users_id} value={String(a.users_id)}>{a.name}</option>)}
          </select>
        )}

        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border"
          style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }} aria-label={fr ? "Actualiser" : "Refresh"}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {fr ? "Actualiser" : "Refresh"}
        </button>
      </div>

      {notConnected && (
        <div className="rounded-lg border p-3 text-xs mb-3"
          style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
          {fr
            ? "Votre compte Maestro n'est pas connecté. Connectez-le dans Réglages › Connexions pour afficher les commissions en direct."
            : "Your Maestro account is not connected. Connect it in Settings › Connections to load live commissions."}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border p-3 text-xs mb-3"
          style={{ borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }}>
          <AlertCircle className="w-4 h-4 mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scope === "admin" && coverage && (
        <div className="rounded-lg border p-3 text-xs mb-3" data-testid="commission-coverage"
          style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
          {fr
            ? `Portée Maestro : ${coverage.connected} courtier(s) connecté(s) sur ${coverage.total}. L'API de commissions ne renvoie que les dépôts du courtier propriétaire du jeton — les courtiers non connectés à Maestro n'apparaissent pas dans les chiffres en direct.`
            : `Maestro scope: ${coverage.connected} connected broker(s) out of ${coverage.total}. The commissions API only returns deposits owned by each token holder — brokers not connected to Maestro are excluded from live figures.`}
        </div>
      )}

      <div className="text-[11px] mb-3 opacity-70" data-testid="commission-filter-label">{filterLabel}</div>


      {summary && (
        <>
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            {[
              [fr ? "Commissions" : "Commissions", cad(summary.total_commission)],
              [fr ? "Dépôts" : "Deposits", String(summary.deposit_count)],
              [fr ? "Moyenne" : "Average", cad(summary.average_commission)],
              [fr ? "Volume de prêts" : "Loan volume", cad(summary.total_loan_volume)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border p-3" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
                <div className="text-lg font-bold mt-1">{value}</div>
              </div>
            ))}
          </div>

          {chart.length > 0 && (
            <div className="rounded-xl border p-3 mb-4" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={60} />
                  <Tooltip formatter={(v: number) => cad2(v)} />
                  <Bar dataKey="amount" fill="var(--pp-brand-accent, #9B7FE8)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {scope === "admin" && !agentId && (
            <>
              {byAgentError && (
                <div className="rounded-xl border p-3 text-xs mb-4" data-testid="by-agent-error"
                  style={{ borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }}>
                  <div className="font-semibold mb-1">{fr ? "Échec du rapport « Par courtier »" : "\"By broker\" report failed"}</div>
                  <div>{byAgentError}</div>
                  <div className="opacity-80 mt-1">{filterLabel}</div>
                </div>
              )}

              {!byAgentError && !loading && byAgent.length === 0 && (
                <div className="rounded-xl border p-4 text-xs mb-4 text-center" data-testid="by-agent-empty"
                  style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                  <div className="font-semibold mb-1">{fr ? "Aucune commission pour ce filtre" : "No commissions for this filter"}</div>
                  <div className="opacity-70">{filterLabel}</div>
                  <div className="opacity-70 mt-1">
                    {byAgentMeta?.sources
                      ? (fr
                          ? `${byAgentMeta.sources.queried} compte(s) Maestro interrogé(s), ${byAgentMeta.sources.failed} en erreur.`
                          : `${byAgentMeta.sources.queried} Maestro account(s) queried, ${byAgentMeta.sources.failed} failed.`)
                      : (fr ? "Essayez la période « Tout »." : "Try the \"All time\" period.")}
                  </div>
                  <button onClick={() => setPeriod("all")} className="mt-2 px-3 py-1.5 rounded-lg border text-xs"
                    style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                    {fr ? "Voir toutes les périodes" : "Show all time"}
                  </button>
                </div>
              )}

              {byAgentMeta?.sources?.failed ? (
                <div className="rounded-xl border p-3 text-[11px] mb-4"
                  style={{ borderColor: "rgba(245,158,11,0.45)", color: "#b45309" }}>
                  {fr
                    ? `${byAgentMeta.sources.failed} courtier(s) n'ont pas pu être interrogés :`
                    : `${byAgentMeta.sources.failed} broker(s) could not be queried:`}
                  <ul className="list-disc ml-4 mt-1">
                    {(byAgentMeta.sources.failures ?? []).map((f, i) => (
                      <li key={i}>{f.broker} — {f.message} (HTTP {f.status})</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {byAgentMeta?.truncated && (
                <div className="text-[11px] mb-3" style={{ color: "#b45309" }}>
                  {fr ? "Résultats tronqués (limite de pages Maestro atteinte) — affinez la période." : "Results truncated (Maestro page limit) — narrow the period."}
                </div>
              )}

              {byAgent.length > 0 && (
              <>
              <div className="rounded-xl border p-3 mb-4" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))", height: 260 }}>
                <div className="text-[11px] uppercase tracking-wide opacity-70 mb-1">
                  {fr ? "Top 10 courtiers" : "Top 10 brokers"}
                </div>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={byAgent.slice(0, 10).map((a) => ({ name: a.name, amount: a.total }))} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip formatter={(v: number) => cad2(v)} />
                    <Bar dataKey="amount" fill="var(--pp-brand-accent, #9B7FE8)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto rounded-xl border mb-4" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="p-2">{fr ? "Courtier" : "Broker"}</th>
                      <th className="p-2 text-right">{fr ? "Dépôts" : "Deposits"}</th>
                      <th className="p-2 text-right">{fr ? "Volume de prêts" : "Loan volume"}</th>
                      <th className="p-2 text-right">{fr ? "Moyenne" : "Average"}</th>
                      <th className="p-2 text-right">{fr ? "Commissions" : "Commissions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAgents.map((a, i) => (
                      <tr key={`${a.users_id ?? a.name}-${i}`} className="border-t"
                        style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.18))" }}>
                        <td className="p-2">
                          {a.users_id != null ? (
                            <button className="underline underline-offset-2"
                              onClick={() => setAgentId(String(a.users_id))}>{a.name}</button>
                          ) : a.name}
                        </td>
                        <td className="p-2 text-right">{a.count}</td>
                        <td className="p-2 text-right">{cad(a.loan_volume)}</td>
                        <td className="p-2 text-right">{cad(a.average)}</td>
                        <td className="p-2 text-right font-semibold">{cad2(a.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.35))" }}>
                      <td className="p-2">{fr ? `Total — ${byAgentTotals.brokers} courtiers` : `Total — ${byAgentTotals.brokers} brokers`}</td>
                      <td className="p-2 text-right">{byAgentTotals.count}</td>
                      <td className="p-2 text-right">{cad(byAgentTotals.loan_volume)}</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right">{cad2(byAgentTotals.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-[11px] mb-4" data-testid="by-agent-pagination">
                <span className="opacity-70">
                  {fr
                    ? `${byAgentTotals.brokers} courtiers · ${byAgentTotals.count} dépôts · ${cad2(byAgentTotals.total)}`
                    : `${byAgentTotals.brokers} brokers · ${byAgentTotals.count} deposits · ${cad2(byAgentTotals.total)}`}
                </span>
                <span className="flex items-center gap-2">
                  <button disabled={byAgentPage <= 1} onClick={() => setByAgentPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                    {fr ? "Précédent" : "Previous"}
                  </button>
                  <span>{byAgentPage} / {byAgentPages}</span>
                  <button disabled={byAgentPage >= byAgentPages} onClick={() => setByAgentPage((p) => Math.min(byAgentPages, p + 1))}
                    className="px-2 py-1 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
                    {fr ? "Suivant" : "Next"}
                  </button>
                </span>
              </div>
              </>
              )}
            </>
          )}


          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.25))" }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="p-2">{fr ? "Date" : "Date"}</th>
                  <th className="p-2">{fr ? "Contrat" : "Contract"}</th>
                  <th className="p-2">{fr ? "Institution" : "Lender"}</th>
                  {scope === "admin" && <th className="p-2">{fr ? "Courtier" : "Broker"}</th>}
                  <th className="p-2 text-right">{fr ? "Prêt" : "Loan"}</th>
                  <th className="p-2 text-right">{fr ? "Commission" : "Commission"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.number}-${i}`} className="border-t" style={{ borderColor: "var(--pp-bg-border, rgba(120,120,150,0.18))" }}>
                    <td className="p-2">{(r.date_trans ?? "").slice(0, 10)}</td>
                    <td className="p-2">{r.number ?? "—"}</td>
                    <td className="p-2">{r.institution ?? "—"}</td>
                    {scope === "admin" && <td className="p-2">{r.agent_name ?? "—"}</td>}
                    <td className="p-2 text-right">{cad(numOf(r.loan_amt))}</td>
                    <td className="p-2 text-right font-semibold">{cad2(numOf(r.amount))}</td>
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr><td colSpan={scope === "admin" ? 6 : 5} className="p-4 text-center opacity-60">
                    {fr ? "Aucun dépôt pour cette période." : "No deposits for this period."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
