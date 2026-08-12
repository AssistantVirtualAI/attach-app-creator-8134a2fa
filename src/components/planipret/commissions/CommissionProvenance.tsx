import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Prov = {
  maestro_record_id: string | null;
  criteria: { record_type: string | null; stage: string | null } | null;
  revenue_field: string | null;
  revenue_raw: unknown;
  rule_matched: boolean;
  status: "mapped" | "unmapped";
  reason: string | null;
  date: string | null;
  lender: string;
  product: string;
  amount: number;
  commission: number;
  counted: boolean;
};

type Validation = {
  status: "ok" | "warnings" | "blocked";
  summary: string;
  checked: number;
  anomalies: Array<{ record_id: string | null; type: string; severity: string; detail: string }>;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

const rawText = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export default function CommissionProvenance({ lang, fiscalYear }: { lang: "fr" | "en"; fiscalYear?: number }) {
  const isFr = lang !== "en";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Prov[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  const [showAnomalies, setShowAnomalies] = useState(false);

  const validate = useCallback(async (provenance: Prov[], auditSummary: any) => {
    setValidating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: err } = await supabase.functions.invoke("pp-commissions-validate", {
        body: { lang: isFr ? "fr" : "en", provenance, audit: auditSummary },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (err) throw err;
      if ((data as any)?.success) setValidation(data as Validation);
    } catch {
      /* validation is advisory */
    } finally {
      setValidating(false);
    }
  }, [isFr]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error: err } = await supabase.functions.invoke("pp-maestro-commissions", {
          body: { fiscal_year: fiscalYear ?? new Date().getFullYear() },
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        if (err) throw err;
        const d = (data ?? {}) as any;
        if (cancelled) return;
        if (!d.success) {
          setError(String(d.error ?? (isFr ? "Données Maestro indisponibles." : "Maestro data unavailable.")));
          setRows([]);
          return;
        }
        const prov: Prov[] = Array.isArray(d.provenance) ? d.provenance : [];
        setRows(prov);
        setAudit(d.audit ?? null);
        if (prov.length) void validate(prov, d.audit ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fiscalYear, isFr, validate]);

  if (loading) {
    return (
      <div className="pp-card flex items-center gap-2" style={{ padding: 16, fontSize: 13, color: "var(--pp-text-muted)" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        {isFr ? "Lecture des données Maestro…" : "Reading Maestro data…"}
      </div>
    );
  }

  if (error) {
    return <div className="pp-card" style={{ padding: 14, fontSize: 12.5, color: "var(--pp-danger)" }}>{error}</div>;
  }

  const vStyle = validation?.status === "ok"
    ? { bg: "rgba(34,197,94,.10)", fg: "#22c55e", Icon: CheckCircle2 }
    : validation?.status === "blocked"
      ? { bg: "rgba(239,68,68,.10)", fg: "#ef4444", Icon: XCircle }
      : { bg: "rgba(245,158,11,.10)", fg: "#f59e0b", Icon: AlertTriangle };

  return (
    <div className="space-y-3">
      {/* AI validation banner */}
      <div className="pp-card" style={{ padding: 14, background: validation ? vStyle.bg : undefined }}>
        <div className="flex items-start gap-2.5">
          {validating
            ? <Loader2 className="w-4 h-4 animate-spin mt-0.5" style={{ color: "var(--pp-text-muted)" }} />
            : <vStyle.Icon className="w-4 h-4 mt-0.5" style={{ color: validation ? vStyle.fg : "var(--pp-text-muted)" }} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5" style={{ fontSize: 13, fontWeight: 700, color: "var(--pp-text-primary)" }}>
              <ShieldCheck className="w-3.5 h-3.5" />
              {isFr ? "Validation IA des montants" : "AI validation of amounts"}
            </div>
            <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 4 }}>
              {validating
                ? (isFr ? "Analyse des données Maestro en cours…" : "Analyzing Maestro data…")
                : validation?.summary
                  || (isFr ? "Validation indisponible pour le moment." : "Validation unavailable right now.")}
            </p>
            {!!validation?.anomalies?.length && (
              <button
                onClick={() => setShowAnomalies((s) => !s)}
                style={{ fontSize: 12, fontWeight: 600, color: vStyle.fg, marginTop: 6 }}
              >
                {validation.anomalies.length} {isFr ? "anomalie(s)" : "anomaly(ies)"} — {showAnomalies ? (isFr ? "masquer" : "hide") : (isFr ? "voir le détail" : "see details")}
              </button>
            )}
            {showAnomalies && (
              <ul className="mt-2 space-y-1.5">
                {validation?.anomalies.map((a, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>
                    <span style={{ fontWeight: 600 }}>{a.record_id ?? "—"}</span> · {a.type} · {a.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Audit summary */}
      {audit && (
        <div className="pp-card flex flex-wrap gap-x-5 gap-y-1.5" style={{ padding: 12, fontSize: 12 }}>
          <span style={{ color: "var(--pp-text-muted)" }}>
            {isFr ? "Lignes" : "Lines"}: <b style={{ color: "var(--pp-text-primary)" }}>{audit.total}</b>
          </span>
          <span style={{ color: "var(--pp-text-muted)" }}>
            {isFr ? "Mappées" : "Mapped"}: <b style={{ color: "#22c55e" }}>{audit.mapped}</b>
          </span>
          <span style={{ color: "var(--pp-text-muted)" }}>
            {isFr ? "Non mappées" : "Unmapped"}: <b style={{ color: "#f59e0b" }}>{audit.unmapped}</b>
          </span>
          <span style={{ color: "var(--pp-text-muted)" }}>
            {isFr ? "Mode strict" : "Strict mode"}: <b style={{ color: "var(--pp-text-primary)" }}>{audit.strict ? (isFr ? "oui" : "yes") : (isFr ? "non (règles à définir)" : "no (rules pending)")}</b>
          </span>
          {Object.keys(audit.fields_used ?? {}).length > 0 && (
            <span style={{ color: "var(--pp-text-muted)" }}>
              {isFr ? "Champs utilisés" : "Fields used"}:{" "}
              <b style={{ color: "var(--pp-text-primary)" }}>
                {Object.entries(audit.fields_used as Record<string, number>).map(([f, c]) => `${f} (${c})`).join(", ")}
              </b>
            </span>
          )}
        </div>
      )}

      {/* Provenance table */}
      <div className="pp-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--pp-bg-elevated)" }}>
              {[
                isFr ? "Dossier" : "Record",
                isFr ? "Type" : "Type",
                isFr ? "Étape" : "Stage",
                isFr ? "Champ source Maestro" : "Maestro source field",
                isFr ? "Valeur brute" : "Raw value",
                isFr ? "Montant affiché" : "Displayed amount",
                isFr ? "Statut" : "Status",
              ].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontWeight: 700, color: "var(--pp-text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.maestro_record_id ?? i}-${i}`} style={{ borderTop: "1px solid var(--pp-bg-border)", opacity: r.counted ? 1 : 0.72 }}>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-primary)", fontWeight: 600 }}>{r.maestro_record_id ?? "—"}</td>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-secondary)" }}>{r.criteria?.record_type ?? "—"}</td>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-secondary)" }}>{r.criteria?.stage ?? "—"}</td>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-secondary)", fontFamily: "Fira Code, monospace" }}>{r.revenue_field ?? "—"}</td>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-secondary)", fontFamily: "Fira Code, monospace" }}>{rawText(r.revenue_raw)}</td>
                <td style={{ padding: "9px 12px", color: "var(--pp-text-primary)", fontWeight: 600 }}>{fmt(r.commission)}</td>
                <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: r.status === "mapped" ? "rgba(34,197,94,.14)" : "rgba(245,158,11,.14)",
                    color: r.status === "mapped" ? "#22c55e" : "#f59e0b",
                  }}>
                    {r.status === "mapped" ? (isFr ? "Mappée" : "Mapped") : `${isFr ? "Non mappée" : "Unmapped"}${r.reason ? ` · ${r.reason}` : ""}`}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} style={{ padding: 18, textAlign: "center", color: "var(--pp-text-muted)" }}>
                  {isFr ? "Aucune ligne retournée par Maestro." : "No line returned by Maestro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
        {isFr
          ? "Chaque montant affiché est la valeur brute du champ Maestro indiqué — aucun recalcul n'est appliqué. Les lignes non mappées sont exclues des totaux en mode strict."
          : "Every displayed amount is the raw value of the listed Maestro field — no recalculation is applied. Unmapped lines are excluded from totals in strict mode."}
      </p>
    </div>
  );
}
