import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { ShieldCheck, AlertTriangle, Database, Users, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Lang = "fr" | "en";

const fmtMoney = (v: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v || 0);
const fmtNum = (v: number) => new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 }).format(v || 0);

type Row = {
  fiscal_year: number | null;
  loan_amt: number | null;
  amount: number | null;
  agent_name: string | null;
  date_trans: string | null;
  broker_user_id: string | null;
  map_status: string | null;
};

export default function CommissionCoverage({ lang }: { lang: Lang }) {
  const isFr = lang === "fr";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const all: Row[] = [];
        for (let page = 0; page < 20; page++) {
          const { data, error } = await supabase
            .from("planipret_commission_register")
            .select("fiscal_year,loan_amt,amount,agent_name,date_trans,broker_user_id,map_status")
            .order("source_row", { ascending: true })
            .range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          all.push(...((data ?? []) as Row[]));
          if (!data || data.length < 1000) break;
        }
        if (!cancelled) setRows(all);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const agg = useMemo(() => {
    if (!rows) return null;
    const byYear = new Map<number, { year: number; rows: number; volume: number; commission: number; brokers: Set<string> }>();
    const brokers = new Map<string, { name: string; rows: number; volume: number; commission: number; linked: boolean }>();
    let missingDate = 0, unlinked = 0, mapIssues = 0;
    for (const r of rows) {
      const y = r.fiscal_year ?? 0;
      if (!byYear.has(y)) byYear.set(y, { year: y, rows: 0, volume: 0, commission: 0, brokers: new Set() });
      const b = byYear.get(y)!;
      b.rows++; b.volume += Number(r.loan_amt || 0); b.commission += Number(r.amount || 0);
      const name = (r.agent_name || "—").trim();
      b.brokers.add(name);
      if (!brokers.has(name)) brokers.set(name, { name, rows: 0, volume: 0, commission: 0, linked: !!r.broker_user_id });
      const bb = brokers.get(name)!;
      bb.rows++; bb.volume += Number(r.loan_amt || 0); bb.commission += Number(r.amount || 0);
      if (r.broker_user_id) bb.linked = true;
      if (!r.date_trans) missingDate++;
      if (!r.broker_user_id) unlinked++;
      if (r.map_status && r.map_status !== "ok") mapIssues++;
    }
    return {
      years: [...byYear.values()].sort((a, b) => a.year - b.year),
      brokers: [...brokers.values()].sort((a, b) => b.volume - a.volume),
      totals: {
        rows: rows.length,
        volume: rows.reduce((s, r) => s + Number(r.loan_amt || 0), 0),
        commission: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
      },
      missingDate, unlinked, mapIssues,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="pp-card" style={{ padding: 20, textAlign: "center", color: "var(--pp-text-muted)" }}>
        <Loader2 className="w-5 h-5 animate-spin inline" />
      </div>
    );
  }
  if (err || !agg) {
    return <div className="pp-card" style={{ padding: 14, fontSize: 12.5, color: "#ef4444" }}>{err}</div>;
  }

  const clean = agg.missingDate === 0 && agg.unlinked === 0 && agg.mapIssues === 0;
  const PALETTE = ["#4472C4", "#70AD47", "#ED7D31", "#8B5CF6", "#14B8A6", "#EC4899"];

  return (
    <div className="pp-card" style={{ padding: 14, borderRadius: 14, marginTop: 12 }}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Database className="w-4 h-4" style={{ color: "var(--pp-brand-accent-2)" }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)" }}>
          {isFr ? "Couverture des données importées" : "Imported data coverage"}
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
          fontSize: 11.5, fontWeight: 800,
          background: clean ? "rgba(22,163,74,.12)" : "rgba(245,158,11,.14)",
          color: clean ? "#16a34a" : "#f59e0b",
        }}>
          {clean ? <><ShieldCheck className="w-3.5 h-3.5" />{isFr ? "Aucun écart détecté" : "No gap detected"}</>
            : <><AlertTriangle className="w-3.5 h-3.5" />{isFr ? "Anomalies détectées" : "Anomalies detected"}</>}
        </span>
        <span className="ml-auto" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
          {fmtNum(agg.totals.rows)} {isFr ? "lignes" : "rows"} · {fmtMoney(agg.totals.volume)} · {fmtMoney(agg.totals.commission)}
        </span>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--pp-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: .3 }}>
            {isFr ? "Lignes par année de registre" : "Rows per register year"}
          </div>
          <div style={{ height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={agg.years}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,.18)" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                <Tooltip
                  contentStyle={{ background: "rgba(10,16,30,.92)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, color: "#fff", fontSize: 12 }}
                  formatter={(v: any, n: any) => [n === "rows" ? fmtNum(Number(v)) : fmtMoney(Number(v)), n === "rows" ? (isFr ? "Lignes" : "Rows") : n]}
                />
                <Bar dataKey="rows" radius={[5, 5, 0, 0]}>
                  {agg.years.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--pp-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: .3 }}>
            {isFr ? "Détail par année" : "Detail per year"}
          </div>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--pp-text-muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>{isFr ? "Année" : "Year"}</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>{isFr ? "Lignes" : "Rows"}</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Volume</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Commission</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>{isFr ? "Courtiers" : "Brokers"}</th>
              </tr>
            </thead>
            <tbody>
              {agg.years.map((y) => (
                <tr key={y.year} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 700 }}>{y.year || "—"}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtNum(y.rows)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMoney(y.volume)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMoney(y.commission)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtNum(y.brokers.size)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--pp-bg-border)", fontWeight: 800 }}>
                <td style={{ padding: "6px 8px" }}>Total</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtNum(agg.totals.rows)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMoney(agg.totals.volume)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMoney(agg.totals.commission)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtNum(agg.brokers.length)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--pp-text-muted)", textTransform: "uppercase", letterSpacing: .3 }}>
            {isFr ? "Courtiers présents dans le registre" : "Brokers present in the register"}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {agg.brokers.map((b) => (
            <span key={b.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
              fontSize: 11.5, fontWeight: 700, background: "var(--pp-bg-elevated)",
              border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)",
            }}>
              {b.name}
              <span style={{ color: "var(--pp-text-muted)", fontWeight: 600 }}>· {fmtNum(b.rows)} · {fmtMoney(b.volume)}</span>
              <span style={{ color: b.linked ? "#16a34a" : "#f59e0b", fontWeight: 800 }}>{b.linked ? (isFr ? "lié" : "linked") : (isFr ? "non lié" : "unlinked")}</span>
            </span>
          ))}
        </div>
      </div>

      <ul style={{ fontSize: 12, color: "var(--pp-text-secondary)", lineHeight: 1.65, marginTop: 10, paddingLeft: 16, listStyle: "disc" }}>
        <li>
          {isFr
            ? `Le fichier source contient ${fmtNum(agg.brokers.length)} courtier(s) distinct(s) : les onglets « registre-depots 2022→2026 » ne comportent que ces noms. Les autres courtiers apparaîtront automatiquement dès qu'un fichier les incluant sera importé.`
            : `The source file contains ${fmtNum(agg.brokers.length)} distinct broker(s): the "registre-depots 2022→2026" sheets only include those names. Other brokers appear automatically once a file containing them is imported.`}
        </li>
        <li>
          {isFr
            ? `Contrôles d'intégrité : ${agg.missingDate} ligne(s) sans date, ${agg.unlinked} ligne(s) non rattachée(s) à un compte courtier, ${agg.mapIssues} ligne(s) avec mappage à revoir.`
            : `Integrity checks: ${agg.missingDate} row(s) without date, ${agg.unlinked} row(s) not linked to a broker account, ${agg.mapIssues} row(s) with mapping to review.`}
        </li>
        <li>
          {isFr
            ? "Volume = somme des montants de prêt du registre (avant déduplication) ; les onglets analytiques dédupliquent par contrat + prêteur + type."
            : "Volume = sum of register loan amounts (before dedup); analytic tabs dedupe by contract + lender + type."}
        </li>
      </ul>
    </div>
  );
}
