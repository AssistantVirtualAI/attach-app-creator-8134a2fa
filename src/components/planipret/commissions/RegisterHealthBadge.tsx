import { ShieldCheck, AlertTriangle, Database } from "lucide-react";

type Lang = "fr" | "en";

export type Integrity = {
  totalRows: number;
  years: { year: number; rows: number; volume: number; commission: number; sheets: string[]; outOfYear: number }[];
  duplicateRows: number;
  orphanRows: number;
  missingDate: number;
  missingAmount: number;
  outOfYear: number;
  clean: boolean;
};

const fmtNum = (v: number) => new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 }).format(v || 0);

/** Compact data-health strip: one glance tells the broker their register is complete. */
export default function RegisterHealthBadge({ integrity, lang }: { integrity?: Integrity | null; lang: Lang }) {
  if (!integrity) return null;
  const isFr = lang === "fr";
  const ok = integrity.clean;
  const issues: string[] = [];
  if (integrity.duplicateRows) issues.push(`${fmtNum(integrity.duplicateRows)} ${isFr ? "doublons" : "duplicates"}`);
  if (integrity.missingDate) issues.push(`${fmtNum(integrity.missingDate)} ${isFr ? "sans date" : "missing date"}`);
  if (integrity.missingAmount) issues.push(`${fmtNum(integrity.missingAmount)} ${isFr ? "sans montant" : "missing amount"}`);
  if (integrity.outOfYear) issues.push(`${fmtNum(integrity.outOfYear)} ${isFr ? "hors année" : "out of year"}`);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3 px-3 py-2 rounded-xl"
      style={{
        background: ok ? "rgba(22,163,74,.08)" : "rgba(245,158,11,.10)",
        border: `1px solid ${ok ? "rgba(22,163,74,.28)" : "rgba(245,158,11,.30)"}`,
      }}
    >
      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 800, color: ok ? "#16a34a" : "#f59e0b" }}>
        {ok ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        {ok
          ? (isFr ? "Données complètes" : "Data complete")
          : (isFr ? "Données à vérifier" : "Data needs review")}
      </span>
      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
        <Database className="w-3.5 h-3.5" />
        {fmtNum(integrity.totalRows)} {isFr ? "lignes importées" : "imported rows"}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {integrity.years.map((y) => (
          <span
            key={y.year}
            className="px-2 py-0.5 rounded-md"
            style={{
              fontSize: 11, fontWeight: 700,
              background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)",
              color: "var(--pp-text-secondary)",
            }}
            title={`${fmtNum(y.rows)} ${isFr ? "lignes" : "rows"}${y.sheets.length ? ` · ${y.sheets.join(", ")}` : ""}`}
          >
            {y.year} · {fmtNum(y.rows)}
          </span>
        ))}
      </div>
      {issues.length > 0 && (
        <span style={{ fontSize: 11.5, color: "#f59e0b", fontWeight: 700 }}>{issues.join(" · ")}</span>
      )}
    </div>
  );
}
