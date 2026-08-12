import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Database } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CommissionValidationPanel from "@/components/planipret/commissions/CommissionValidationPanel";

const FIELDS = [
  "number", "loan_amt", "primary_client_name", "secondary_client_name", "institution",
  "financial_inst_id", "is_adjustment", "points", "buy_down", "amount", "mortgage_type",
  "term", "agent_name", "target_name", "date_trans", "commission_type", "split_type",
  "agent_company", "cabinet",
] as const;
type Field = (typeof FIELDS)[number];

const ALIASES: Record<Field, string[]> = {
  number: ["number", "numero", "numéro", "no", "contract", "dossier"],
  loan_amt: ["loan_amt", "loan amount", "montant pret", "montant prêt", "loanamt", "montant du pret"],
  primary_client_name: ["primary_client_name", "client", "client1", "nom client"],
  secondary_client_name: ["secondary_client_name", "client2", "coclient"],
  institution: ["institution", "lender", "preteur", "prêteur", "banque"],
  financial_inst_id: ["financial_inst_id", "inst_id", "id institution"],
  is_adjustment: ["is_adjustment", "adjustment", "ajustement"],
  points: ["points", "pts"],
  buy_down: ["buy_down", "buydown", "rachat"],
  amount: ["amount", "montant", "commission", "montant commission"],
  mortgage_type: ["mortgage_type", "type", "type pret", "type prêt", "produit"],
  term: ["term", "terme", "duree", "durée"],
  agent_name: ["agent_name", "agent", "courtier", "broker", "nom agent"],
  target_name: ["target_name", "target", "cible"],
  date_trans: ["date_trans", "date", "date transaction", "transaction date"],
  commission_type: ["commission_type", "type commission", "comm type"],
  split_type: ["split_type", "split", "partage"],
  agent_company: ["agent_company", "company", "compagnie"],
  cabinet: ["cabinet", "office", "bureau"],
};

const norm = (s: string) => s.toString().trim().toLowerCase().replace(/[\s_-]+/g, " ");

function autoMap(headers: string[]): Record<Field, string> {
  const map = {} as Record<Field, string>;
  for (const f of FIELDS) {
    const found = headers.find((h) => ALIASES[f].some((a) => norm(h) === norm(a)))
      ?? headers.find((h) => ALIASES[f].some((a) => norm(h).includes(norm(a))));
    map[f] = found ?? "";
  }
  return map;
}

interface SheetData { name: string; headers: string[]; rows: any[][] }

export default function PACommissionsImport() {
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mapping, setMapping] = useState<Record<Field, string>>({} as any);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [result, setResult] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);

  const activeSheets = useMemo(() => sheets.filter((s) => selected[s.name]), [sheets, selected]);
  const allHeaders = useMemo(() => Array.from(new Set(activeSheets.flatMap((s) => s.headers))), [activeSheets]);

  const onFile = async (file: File) => {
    setResult(null);
    setAnalysis(null);
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: false });
    const parsed: SheetData[] = wb.SheetNames.map((name) => {
      const arr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, blankrows: false, raw: true });
      const headers = (arr[0] ?? []).map((h: any) => String(h ?? "").trim());
      return { name, headers, rows: arr.slice(1) };
    }).filter((s) => s.headers.length > 3 && s.rows.length > 0);
    setSheets(parsed);
    const sel: Record<string, boolean> = {};
    for (const s of parsed) {
      sel[s.name] = /registre|raw|depot|dépôt/i.test(s.name) || parsed.length === 1;
    }
    if (!Object.values(sel).some(Boolean)) parsed.forEach((s) => (sel[s.name] = true));
    setSelected(sel);
    const heads = Array.from(new Set(parsed.filter((s) => sel[s.name]).flatMap((s) => s.headers)));
    setMapping(autoMap(heads));
  };

  const buildRows = () => {
    const out: any[] = [];
    let order = 1;
    for (const s of activeSheets) {
      const idx: Partial<Record<Field, number>> = {};
      for (const f of FIELDS) {
        const col = mapping[f];
        if (col) idx[f] = s.headers.indexOf(col);
      }
      for (const row of s.rows) {
        const rec: any = { source_row: order++, sheet: s.name };
        for (const f of FIELDS) {
          const i = idx[f];
          rec[f] = i !== undefined && i >= 0 ? row[i] : undefined;
        }
        if (rec.date_trans === undefined || rec.date_trans === null || rec.date_trans === "") continue;
        const raw: Record<string, any> = {};
        s.headers.forEach((h, i) => { if (h) raw[h] = row[i]; });
        rec.raw = raw;
        out.push(rec);
      }
    }
    return out;
  };

  const preview = useMemo(() => (activeSheets.length ? buildRows().slice(0, 5) : []), [activeSheets, mapping]);
  const totalRows = useMemo(() => activeSheets.reduce((s, x) => s + x.rows.length, 0), [activeSheets]);

  const call = async (payload: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("pp-commission-import", {
      body: payload,
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const doAnalyze = async () => {
    if (!activeSheets.length) return;
    setAnalyzing(true);
    try {
      const payloadSheets = activeSheets.slice(0, 8).map((s) => {
        const ctCol = mapping.commission_type ? s.headers.indexOf(mapping.commission_type) : -1;
        return {
          name: s.name,
          headers: s.headers,
          samples: s.rows.slice(0, 3),
          commissionTypeSamples: ctCol >= 0
            ? Array.from(new Set(s.rows.map((r) => String(r[ctCol] ?? "").trim()).filter(Boolean))).slice(0, 60)
            : [],
        };
      });
      const res = await call({ action: "analyze", sheets: payloadSheets });
      setAnalysis(res);
      // Apply column suggestions to the visible mapping (header -> field becomes field -> header)
      const next = { ...mapping };
      for (const [header, field] of Object.entries(res.columns ?? {})) {
        if (field && field !== "__ignore__" && (FIELDS as readonly string[]).includes(String(field)) && allHeaders.includes(header)) {
          if (!next[field as Field]) next[field as Field] = header;
        }
      }
      setMapping(next);
      toast.success(isFr
        ? `Analyse terminée${res.aiUsed ? " (Claude)" : ""} — ${res.unknownHeaders?.length ?? 0} colonne(s) à confirmer`
        : `Analysis done${res.aiUsed ? " (Claude)" : ""} — ${res.unknownHeaders?.length ?? 0} column(s) to confirm`);
    } catch (e: any) {
      toast.error(e?.message ?? "Analyse impossible");
    } finally {
      setAnalyzing(false);
    }
  };

  const doImport = async () => {
    if (!mapping.date_trans) { toast.error(isFr ? "Colonne date requise" : "Date column required"); return; }
    setBusy(true);
    try {
      const rows = buildRows();
      const CHUNK = 4000;
      let inserted = 0;
      let unmatched: string[] = [];
      let unmappedTypes: string[] = [];
      let years: number[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await call({
          action: "import",
          fileName,
          mode,
          rows: rows.slice(i, i + CHUNK),
          replaceYears: mode === "replace" && i === 0,
          commissionTypes: analysis?.commissionTypes ?? undefined,
        });
        inserted += res.inserted ?? 0;
        unmatched = Array.from(new Set([...unmatched, ...(res.unmatched ?? [])]));
        unmappedTypes = Array.from(new Set([...unmappedTypes, ...(res.unmappedTypes ?? [])]));
        years = Array.from(new Set([...years, ...(res.years ?? [])]));
      }
      setResult({ inserted, unmatched, unmappedTypes, years });
      toast.success(isFr ? `${inserted} lignes importées` : `${inserted} rows imported`);
      void loadSummary();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };


  const loadSummary = async () => {
    try { setSummary(await call({ action: "summary" })); } catch { /* ignore */ }
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<FileSpreadsheet className="w-5 h-5" />}
        title={isFr ? "Import registre de commissions" : "Commission register import"}
        subtitle={isFr
          ? "Importez le registre de dépôts (2022→2026). Les données alimentent les portails courtiers."
          : "Import the deposit register (2022→2026). Data feeds the broker portals."}
      />

      <div className="pp-card" style={{ padding: 16 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg"
          style={{ background: "var(--pp-brand-accent-2)", color: "#fff", fontSize: 13, fontWeight: 600 }}
        >
          <Upload className="w-4 h-4" />{isFr ? "Choisir un fichier" : "Choose a file"}
        </button>
        {fileName && (
          <div className="mt-2" style={{ fontSize: 12.5, color: "var(--pp-text-muted)" }}>
            {fileName} — {sheets.length} {isFr ? "feuilles détectées" : "sheets detected"}
          </div>
        )}
      </div>

      {sheets.length > 0 && (
        <div className="pp-card mt-3" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{isFr ? "Feuilles à importer" : "Sheets to import"}</div>
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <label key={s.name} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={!!selected[s.name]}
                  onChange={(e) => {
                    const next = { ...selected, [s.name]: e.target.checked };
                    setSelected(next);
                    const heads = Array.from(new Set(sheets.filter((x) => next[x.name]).flatMap((x) => x.headers)));
                    setMapping(autoMap(heads));
                  }}
                />
                {s.name} <span style={{ color: "var(--pp-text-muted)" }}>({s.rows.length})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {activeSheets.length > 0 && (
        <div className="pp-card mt-3" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {isFr ? "Correspondance des colonnes" : "Column mapping"}
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
            {FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                {f}
                <select
                  value={mapping[f] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}
                  className="px-2 py-1.5 rounded-md"
                  style={{
                    background: "var(--pp-bg-elevated)",
                    border: `1px solid ${!mapping[f] && (f === "date_trans" || f === "amount" || f === "loan_amt") ? "var(--pp-danger)" : "var(--pp-bg-border)"}`,
                    color: "var(--pp-text-primary)", fontSize: 12.5,
                  }}
                >
                  <option value="">—</option>
                  {allHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          {preview.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{isFr ? "Aperçu" : "Preview"}</div>
              <table style={{ fontSize: 11.5, borderCollapse: "collapse" }}>
                <thead>
                  <tr>{FIELDS.map((f) => <th key={f} style={{ padding: "4px 8px", textAlign: "left", color: "var(--pp-text-muted)" }}>{f}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>{FIELDS.map((f) => <td key={f} style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{String(r[f] ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={doImport}
            disabled={busy}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{ background: "var(--pp-success, #16a34a)", color: "#fff", fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {isFr ? `Importer ${totalRows} lignes` : `Import ${totalRows} rows`}
          </button>
          <div className="mt-1" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
            {isFr ? "Les années présentes dans le fichier sont remplacées (import idempotent)." : "Years present in the file are replaced (idempotent import)."}
          </div>
        </div>
      )}

      {result && (
        <div className="pp-card mt-3" style={{ padding: 16 }}>
          <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 700 }}>
            <CheckCircle2 className="w-4 h-4" style={{ color: "var(--pp-success,#16a34a)" }} />
            {isFr ? `${result.inserted} lignes importées` : `${result.inserted} rows imported`} — {result.years?.join(", ")}
          </div>
          {result.unmatched?.length > 0 && (
            <div className="mt-2" style={{ fontSize: 12.5 }}>
              <div className="flex items-center gap-1.5" style={{ color: "var(--pp-warning,#f59e0b)" }}>
                <AlertTriangle className="w-3.5 h-3.5" />
                {isFr ? "Courtiers non rattachés à un compte :" : "Brokers not linked to an account:"}
              </div>
              <div style={{ color: "var(--pp-text-muted)" }}>{result.unmatched.join(" · ")}</div>
            </div>
          )}
        </div>
      )}

      <div className="pp-card mt-3" style={{ padding: 16 }}>
        <button onClick={loadSummary} className="px-3 py-1.5 rounded-lg"
          style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", fontSize: 12.5, fontWeight: 600 }}>
          {isFr ? "Actualiser l'état du registre" : "Refresh register status"}
        </button>
        {summary && (
          <div className="mt-3" style={{ fontSize: 12.5 }}>
            <div>{isFr ? "Total lignes" : "Total rows"} : <strong>{summary.total}</strong></div>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(summary.byYear ?? {}).sort().map(([y, c]) => (
                <span key={y} className="px-2 py-1 rounded-md"
                  style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)" }}>
                  {y} : {String(c)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <CommissionValidationPanel isFr={isFr} call={call} />

    </PAPage>
  );
}
