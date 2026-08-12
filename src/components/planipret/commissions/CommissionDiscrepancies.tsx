import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, Download, Search } from "lucide-react";

type Lang = "fr" | "en";

const money = (v: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(v) || 0);
const num = (v: number) => new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 }).format(Number(v) || 0);

const STATUS_COLOR: Record<string, string> = {
  "DÉDOUBLONNÉ": "#f59e0b",
  "HORS VOLUME": "#8B5CF6",
  "NON MAPPÉ": "#ef4444",
  OK: "#16a34a",
};

export default function CommissionDiscrepancies({
  lang,
  discrepancies,
}: {
  lang: Lang;
  discrepancies: any;
}) {
  const isFr = lang === "fr";
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");

  const rows: any[] = discrepancies?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind && r.kind !== kind) return false;
      if (!needle) return true;
      return [r.number, r.broker, r.institution, r.commissionType, r.field, r.maestroBrokerId]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, kind, q]);

  const exportCsv = () => {
    const head = ["source_row", "date", "contrat", "courtier", "maestro_id", "institution", "type_pret", "type_commission", "champ", "valeur_brute", "montant_affiche", "ecart", "statut"];
    const body = filtered.map((r) => [
      r.sourceRow, r.date ?? "", r.number ?? "", r.broker ?? "", r.maestroBrokerId ?? "", r.institution ?? "",
      r.mortgageType ?? "", r.commissionType ?? "", r.field, r.rawValue ?? "", r.displayedValue, r.delta, r.status,
    ]);
    const csv = [head, ...body].map((line) => line.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ecarts-commissions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!discrepancies) return null;

  const counts: Record<string, number> = discrepancies.counts ?? {};

  return (
    <div className="pp-card" style={{ padding: 14, borderRadius: 14, marginTop: 12 }}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)" }}>
          {isFr ? "Écarts — valeur brute source vs montant affiché" : "Gaps — raw source value vs displayed amount"}
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
          fontSize: 11.5, fontWeight: 800,
          background: discrepancies.total ? "rgba(245,158,11,.14)" : "rgba(22,163,74,.12)",
          color: discrepancies.total ? "#f59e0b" : "#16a34a",
        }}>
          {discrepancies.total
            ? <><AlertTriangle className="w-3.5 h-3.5" />{num(discrepancies.total)} {isFr ? "écarts" : "gaps"}</>
            : <><ShieldCheck className="w-3.5 h-3.5" />{isFr ? "Aucun écart" : "No gap"}</>}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
          {isFr ? "Lignes analysées" : "Rows scanned"} : {num(discrepancies.scanned)} · {isFr ? "tranches retenues" : "tranches kept"} : {num(discrepancies.countedVolumeRows)} · {isFr ? "écart cumulé" : "cumulated gap"} : {money(discrepancies.totalGap)}
        </span>
        <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ fontSize: 12, fontWeight: 700, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
          <Download className="w-3.5 h-3.5" />CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <button onClick={() => setKind("")} className="px-2.5 py-1 rounded-lg" style={{
          fontSize: 11.5, fontWeight: 700,
          background: kind === "" ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
          color: kind === "" ? "#fff" : "var(--pp-text-secondary)",
          border: "1px solid var(--pp-bg-border)",
        }}>{isFr ? "Tous" : "All"} · {num(discrepancies.total)}</button>
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <button key={k} onClick={() => setKind(k)} className="px-2.5 py-1 rounded-lg" style={{
            fontSize: 11.5, fontWeight: 700,
            background: kind === k ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
            color: kind === k ? "#fff" : "var(--pp-text-secondary)",
            border: "1px solid var(--pp-bg-border)",
          }}>{k.replace(/_/g, " ")} · {num(v)}</button>
        ))}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={isFr ? "Contrat, courtier, prêteur…" : "Contract, broker, lender…"}
            style={{ background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--pp-text-primary)", width: 200 }} />
        </div>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: 520, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr>
              {[isFr ? "Ligne" : "Row", isFr ? "Date" : "Date", isFr ? "Contrat" : "Contract", isFr ? "Courtier" : "Broker",
                isFr ? "Source" : "Source", isFr ? "Champ exact" : "Exact field", isFr ? "Valeur brute" : "Raw value",
                isFr ? "Montant affiché" : "Displayed", isFr ? "Écart" : "Delta", isFr ? "Statut" : "Status"].map((h, i) => (
                <th key={i} style={{
                  position: "sticky", top: 0, zIndex: 1,
                  textAlign: i < 6 ? "left" : "right", padding: "8px 10px", fontSize: 10.5,
                  textTransform: "uppercase", letterSpacing: .3, color: "var(--pp-text-muted)", fontWeight: 800,
                  background: "var(--pp-bg-card)", borderBottom: "1px solid var(--pp-bg-border)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 600).map((r, i) => (
              <tr key={`${r.sourceRow}-${r.field}-${i}`} style={{ background: i % 2 ? "rgba(127,127,127,.045)" : "transparent" }}>
                <td style={cell("left")}>{r.sourceRow}</td>
                <td style={cell("left")}>{r.date ?? "—"}</td>
                <td style={cell("left")}>{r.number ?? "—"}</td>
                <td style={cell("left")}>
                  {[r.firstName, r.lastName].filter(Boolean).join(" ") || r.broker || "—"}
                  {r.maestroBrokerId && <span style={{ color: "var(--pp-text-muted)", fontSize: 10.5 }}> · {r.maestroBrokerId}</span>}
                </td>
                <td style={cell("left")}>{r.source}</td>
                <td style={{ ...cell("left"), fontFamily: "var(--pp-font-mono, monospace)", fontWeight: 700 }}>{r.field}</td>
                <td style={cell("right")}>{r.field === "loan_amt" || r.field === "amount" ? money(Number(r.rawValue ?? 0)) : String(r.rawValue ?? "—")}</td>
                <td style={cell("right")}>{money(r.displayedValue)}</td>
                <td style={{ ...cell("right"), color: r.delta ? "#f59e0b" : "var(--pp-text-primary)", fontWeight: 700 }}>{money(r.delta)}</td>
                <td style={cell("right")}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: STATUS_COLOR[r.status] ?? "var(--pp-text-primary)" }}>{r.status}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 18, textAlign: "center", color: "var(--pp-text-muted)", fontSize: 12.5 }}>
                {isFr ? "Aucun écart pour ce filtre." : "No gap for this filter."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 600 && (
        <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)", marginTop: 6 }}>
          {isFr ? `600 lignes affichées sur ${num(filtered.length)} — exportez le CSV pour la liste complète.` : `Showing 600 of ${num(filtered.length)} rows — export CSV for the full list.`}
        </div>
      )}

      <ul style={{ marginTop: 10, fontSize: 11.5, color: "var(--pp-text-muted)", lineHeight: 1.5 }}>
        {(discrepancies.legend ?? []).map((l: string, i: number) => <li key={i}>• {l}</li>)}
      </ul>
    </div>
  );
}

const cell = (align: "left" | "right"): React.CSSProperties => ({
  padding: "7px 10px",
  textAlign: align,
  whiteSpace: "nowrap",
  color: "var(--pp-text-primary)",
  borderBottom: "1px solid var(--pp-bg-border)",
});
