// Commissions en attente — même passerelle, même portée et même mémoire
// hors-ligne que les commissions déposées (action `pending`).
import { useEffect, useMemo, useState } from "react";
import { Hourglass } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { readStatsCache, statsCacheKey, writeStatsCache, isStatsCacheFresh } from "@/lib/planipret/commissionsCache";
import { ppEdgeInvoke } from "@/lib/planipret/ppEdge";

type Summary = {
  total_commission: number;
  deposit_count: number;
  total_loan_volume: number;
  by_date?: { date: string; amount: number; count: number }[];
  truncated?: boolean;
  official_total?: number | null;
  official_by_type?: { type: string; label: string; amount: number }[] | null;
};

const cad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

const yearRange = () => {
  const y = new Date().getFullYear();
  return { date_from: `${y}-01-01`, date_to: `${y}-12-31` };
};

export default function PendingCommissionsCard({ lang = "fr", filters, cacheScope = "default", refreshToken = 0 }: {
  lang?: "fr" | "en";
  filters?: { date_from?: string; date_to?: string; users_id?: string; financial_inst_id?: string };
  cacheScope?: string;
  refreshToken?: number;
}) {
  const fr = lang !== "en";
  const f = useMemo(() => {
    const base = filters?.date_from && filters?.date_to ? { date_from: filters.date_from, date_to: filters.date_to } : yearRange();
    return {
      ...base,
      ...(filters?.users_id ? { users_id: filters.users_id } : {}),
      ...(filters?.financial_inst_id ? { financial_inst_id: filters.financial_inst_id } : {}),
    };
  }, [filters?.date_from, filters?.date_to, filters?.users_id, filters?.financial_inst_id]);
  const key = statsCacheKey("broker", ["pending", cacheScope, f.date_from, f.date_to, f.users_id ?? "", f.financial_inst_id ?? ""]);
  const [summary, setSummary] = useState<Summary | null>(() => (readStatsCache(key)?.value as Summary) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readStatsCache(key);
    if (cached?.value) setSummary(cached.value as Summary);
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
      writeStatsCache(key, d.summary);
    })()
      .catch(() => { if (!cancelled) setError(fr ? "Commissions en attente indisponibles pour le moment." : "Pending commissions unavailable right now."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshToken]);

  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of summary?.by_date ?? []) {
      const k = String(b.date).slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + Number(b.amount || 0));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, amount]) => ({ month: k, amount: Math.round(amount) }));
  }, [summary]);

  const kpi = (label: string, value: string) => (
    <div className="rounded-xl p-2.5" style={{ background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.25)" }}>
      <div className="text-[10.5px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted, #94A3B8)" }}>{label}</div>
      <div className="text-[16px] font-semibold" style={{ color: "var(--pp-text-primary, #E8EDF5)" }}>{value}</div>
    </div>
  );

  return (
    <section className="rounded-2xl p-3 mb-3" style={{ background: "var(--pp-bg-surface, #0A1628)", border: "1px solid rgba(240,180,41,0.35)" }}>
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold mb-2" style={{ color: "var(--pp-text-primary, #E8EDF5)" }}>
        <Hourglass className="w-4 h-4" style={{ color: "#F0B429" }} />
        {fr ? "Commissions en attente" : "Pending commissions"}
      </h3>
      {error && <p className="text-[11.5px] mb-2" style={{ color: "#F0B429" }}>{error}</p>}
      {loading && !summary ? (
        <p className="text-[12px]" style={{ color: "var(--pp-text-muted, #94A3B8)" }}>…</p>
      ) : summary ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {kpi(fr ? "Montant" : "Amount", cad(summary.official_total ?? summary.total_commission))}
            {kpi(fr ? "Dossiers" : "Files", String(summary.deposit_count))}
            {kpi("Volume", cad(summary.total_loan_volume))}
          </div>
          {!!summary.official_by_type?.length && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {summary.official_by_type.filter((t) => t.amount).map((t) => (
                <span key={t.type} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(240,180,41,0.12)", color: "var(--pp-text-primary, #E8EDF5)" }}>
                  {t.label} · {cad(t.amount)}
                </span>
              ))}
            </div>
          )}
          {months.length > 0 ? (
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94A3B8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} width={48} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => cad(v)} />
                  <Bar dataKey="amount" name={fr ? "En attente" : "Pending"} fill="#F0B429" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--pp-text-muted, #94A3B8)" }}>
              {fr ? "Aucune commission en attente pour cette période." : "No pending commissions for this period."}
            </p>
          )}
          {summary.truncated && (
            <p className="text-[11px] mt-2" style={{ color: "#F0B429" }}>{fr ? "Résultats partiels." : "Partial results."}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
