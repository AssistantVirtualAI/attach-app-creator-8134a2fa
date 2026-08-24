import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Loader2, Upload, Wand2, RefreshCw, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { supabase } from "@/integrations/supabase/client";
import CommissionMappingPanel from "@/components/planipret/commissions/CommissionMappingPanel";

type SheetData = { name: string; headers: string[]; rows: any[][] };

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

const card: React.CSSProperties = {
  background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)",
  borderRadius: 14, padding: 14, marginBottom: 12,
};

export default function PACommissionRegistry() {
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [result, setResult] = useState<any>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await call({ action: "summary" })); } catch { /* empty register */ }
  }, []);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const onFile = async (file: File) => {
    setBusy("parse"); setResult(null); setAnalysis(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const parsed: SheetData[] = wb.SheetNames.map((name) => {
        const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
        const headerIdx = grid.findIndex((r) => (r ?? []).filter((c) => c !== null && String(c).trim()).length >= 3);
        const headers = (grid[headerIdx] ?? []).map((h) => String(h ?? "").trim());
        const rows = grid.slice(headerIdx + 1).filter((r) => (r ?? []).some((c) => c !== null && String(c).trim() !== ""));
        return { name, headers, rows };
      }).filter((s) => s.headers.length > 0 && s.rows.length > 0);

      if (!parsed.length) throw new Error(isFr ? "Aucun onglet exploitable" : "No usable sheet");
      setSheets(parsed);
      setFileName(file.name);
      toast.success(isFr ? `${parsed.length} onglet(s) lus` : `${parsed.length} sheet(s) read`, {
        description: `${parsed.reduce((n, s) => n + s.rows.length, 0)} ${isFr ? "lignes" : "rows"}`,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally { setBusy(null); }
  };

  const runAnalyze = async () => {
    if (!sheets.length) return;
    setBusy("analyze");
    try {
      const idx = (s: SheetData, name: string) => s.headers.findIndex((h) => h.toLowerCase().includes(name));
      const payload = sheets.map((s) => {
        const ct = idx(s, "commission");
        return {
          name: s.name,
          headers: s.headers,
          sampleRows: s.rows.slice(0, 5),
          commissionTypeSamples: ct >= 0
            ? Array.from(new Set(s.rows.slice(0, 400).map((r) => String(r[ct] ?? "").trim()).filter(Boolean)))
            : [],
        };
      });
      const res = await call({ action: "analyze", sheets: payload });
      setAnalysis(res);
      toast.success(isFr ? "Mapping proposé" : "Mapping proposed");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally { setBusy(null); }
  };

  const runImport = async () => {
    if (!sheets.length) return;
    const columns: Record<string, string> = analysis?.columns ?? {};
    if (!Object.keys(columns).length) {
      toast.error(isFr ? "Analysez d'abord le classeur" : "Analyze the workbook first");
      return;
    }
    setBusy("import");
    try {
      const rows: any[] = [];
      for (const s of sheets) {
        s.rows.forEach((r, i) => {
          const rec: any = { sheet: s.name, source_row: i + 2, raw: {} };
          s.headers.forEach((h, c) => {
            const field = columns[h];
            rec.raw[h] = r[c] ?? null;
            if (field) rec[field] = r[c] ?? null;
          });
          rows.push(rec);
        });
      }
      const CHUNK = 2000;
      let inserted = 0, batches = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await call({
          action: "import",
          fileName,
          rows: rows.slice(i, i + CHUNK),
          // Only the very first chunk may replace the affected fiscal years.
          mode: i === 0 ? mode : "merge",
          commissionTypes: analysis?.commissionTypes ?? {},
        });
        inserted += Number(res?.inserted ?? res?.rows ?? 0);
        batches += 1;
        setResult({ inserted, batches, total: rows.length });
      }
      toast.success(isFr ? `${inserted} ligne(s) importées` : `${inserted} row(s) imported`);
      await loadSummary();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally { setBusy(null); }
  };

  const runRemap = async () => {
    setBusy("remap");
    try {
      const res = await call({ action: "remap" });
      toast.success(isFr ? `Mapping rejoué : ${res?.updated ?? 0} ligne(s)` : `Remapped: ${res?.updated ?? 0} row(s)`);
      await loadSummary();
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); } finally { setBusy(null); }
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<Database className="w-5 h-5" />}
        title={isFr ? "Registre global des commissions" : "Global commission register"}
        subtitle={isFr
          ? "Importez le registre Planiprêt (tous les courtiers) pour que la vue « tous les courtiers » affiche tout le monde"
          : "Import the Planiprêt register (all brokers) so the \"all brokers\" view finally shows everyone"}
      />

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 6 }}>
          {isFr ? "Registre actuellement en base" : "Register currently stored"}
        </div>
        {summary ? (
          <div style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
            {isFr
              ? `${summary.totalRows ?? summary.rows ?? 0} ligne(s) · ${(summary.brokers ?? []).length} courtier(s) · années ${(Object.keys(summary.byYear ?? {}) ).join(", ") || "—"}`
              : `${summary.totalRows ?? summary.rows ?? 0} row(s) · ${(summary.brokers ?? []).length} broker(s) · years ${(Object.keys(summary.byYear ?? {})).join(", ") || "—"}`}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--pp-text-muted)" }}>
            {isFr ? "Aucun registre importé pour l'instant." : "No register imported yet."}
          </div>
        )}
        <button onClick={runRemap} disabled={busy !== null}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ fontSize: 12, fontWeight: 700, background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
          {busy === "remap" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {isFr ? "Rejouer le mapping" : "Replay mapping"}
        </button>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 8 }}>
          {isFr ? "1. Sélectionner le classeur" : "1. Select the workbook"}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg"
            style={{ fontSize: 12.5, fontWeight: 700, background: "var(--pp-brand-accent-2)", color: "#fff", border: "1px solid var(--pp-bg-border)" }}>
            {busy === "parse" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isFr ? "Choisir un fichier (xlsx / csv)" : "Choose a file (xlsx / csv)"}
          </button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
              <FileSpreadsheet className="w-4 h-4" />{fileName} · {sheets.length} {isFr ? "onglet(s)" : "sheet(s)"} ·{" "}
              {sheets.reduce((n, s) => n + s.rows.length, 0)} {isFr ? "lignes" : "rows"}
            </span>
          )}
        </div>

        {sheets.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={runAnalyze} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ fontSize: 12.5, fontWeight: 700, background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}>
              {busy === "analyze" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {isFr ? "2. Analyser et proposer le mapping" : "2. Analyze and propose mapping"}
            </button>

            <select value={mode} onChange={(e) => setMode(e.target.value as any)}
              style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 10, padding: "6px 10px", background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}>
              <option value="replace">{isFr ? "Remplacer les années importées" : "Replace imported years"}</option>
              <option value="merge">{isFr ? "Fusionner (ajout / mise à jour)" : "Merge (add / update)"}</option>
            </select>

            <button onClick={runImport} disabled={busy !== null || !analysis}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ fontSize: 12.5, fontWeight: 700, background: analysis ? "#16a34a" : "var(--pp-bg-card)", color: analysis ? "#fff" : "var(--pp-text-muted)", border: "1px solid var(--pp-bg-border)", opacity: busy ? .7 : 1 }}>
              {busy === "import" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isFr ? "3. Importer le registre" : "3. Import register"}
            </button>

            {result && (
              <span style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                {result.inserted}/{result.total} {isFr ? "lignes" : "rows"}
              </span>
            )}
          </div>
        )}

        {analysis?.unknownColumns?.length > 0 && (
          <div className="mt-2" style={{ fontSize: 12, color: "#f59e0b" }}>
            {isFr ? "Colonnes non reconnues : " : "Unrecognized columns: "}{analysis.unknownColumns.join(", ")}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 8 }}>
          {isFr ? "Correspondances (colonnes et types de commission)" : "Mappings (columns and commission types)"}
        </div>
        <CommissionMappingPanel isFr={isFr} call={call} analysis={analysis} />
      </div>
    </PAPage>
  );
}
