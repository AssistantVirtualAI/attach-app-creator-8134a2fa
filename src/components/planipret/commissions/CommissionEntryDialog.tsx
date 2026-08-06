import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Save, Loader2 } from "lucide-react";
import { saveCommissionRow, type CommissionInput, type CommissionRow, SECTION_LABELS } from "@/lib/planipret/commissionStats";

type Lang = "fr" | "en";
const T = (lang: Lang, fr: string, en: string) => (lang === "en" ? en : fr);

const SECTIONS = ["kpi", "lender", "quarter", "commission_type", "product_mix", "term_mix", "matrix", "club", "team"];

const inputStyle: React.CSSProperties = {
  background: "var(--pp-bg-deep)",
  border: "1px solid var(--pp-bg-border-2)",
  color: "var(--pp-text-primary)",
};

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 10, color: "var(--pp-text-faint)", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
      {children}
    </label>
  );
}

export default function CommissionEntryDialog({
  lang = "fr", open, onClose, onSaved, row, brokers, defaultBroker,
}: {
  lang?: Lang;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  row?: CommissionRow | null;
  brokers: string[];
  defaultBroker?: string;
}) {
  const [form, setForm] = useState<CommissionInput>({
    broker_name: "", fiscal_year: new Date().getFullYear(), section: "lender", dimension: "",
    sub_dimension: "", cy_volume: 0, py_volume: 0, cy_deals: 0, py_deals: 0, cy_commission: 0, py_commission: 0,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (row) {
      setForm({
        id: row.id,
        broker_name: row.broker_name,
        broker_user_id: row.broker_user_id,
        fiscal_year: row.fiscal_year,
        section: String(row.section),
        dimension: row.dimension ?? "",
        sub_dimension: row.sub_dimension ?? "",
        rank: row.rank,
        cy_volume: Number(row.cy_volume || 0),
        py_volume: Number(row.py_volume || 0),
        cy_deals: Number(row.cy_deals || 0),
        py_deals: Number(row.py_deals || 0),
        cy_commission: Number(row.cy_commission || 0),
        py_commission: Number(row.py_commission || 0),
        extra: row.extra ?? {},
      });
    } else {
      setForm((f) => ({
        ...f, id: undefined, broker_name: defaultBroker || brokers[0] || "", dimension: "", sub_dimension: "",
        cy_volume: 0, py_volume: 0, cy_deals: 0, py_deals: 0, cy_commission: 0, py_commission: 0, extra: {},
      }));
    }
  }, [open, row, defaultBroker, brokers]);

  if (!open) return null;

  const set = (k: keyof CommissionInput, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof CommissionInput) => (
    <input type="number" step="any" value={String(form[k] ?? 0)} onChange={(e) => set(k, Number(e.target.value))}
      className="rounded-lg px-2 py-1.5 text-[12px] tabular-nums w-full" style={inputStyle} />
  );

  const submit = async () => {
    if (!form.broker_name.trim()) { setErr(T(lang, "Le courtier est requis.", "Broker is required.")); return; }
    setSaving(true); setErr(null);
    try {
      await saveCommissionRow(form);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally { setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="pp-card w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--pp-text-primary)" }}>
              {row ? T(lang, "Modifier la ligne", "Edit row") : T(lang, "Ajouter une donnée", "Add data")}
            </h3>
            <p style={{ fontSize: 10.5, color: "var(--pp-text-faint)" }}>
              {T(lang, "Saisie manuelle — réservée aux admins Planiprêt", "Manual entry — Planiprêt admins only")}
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--pp-text-muted)" }}><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label={T(lang, "Courtier", "Broker")}>
            <input list="pp-brokers" value={form.broker_name} onChange={(e) => set("broker_name", e.target.value)}
              className="rounded-lg px-2 py-1.5 text-[12px] w-full" style={inputStyle} />
            <datalist id="pp-brokers">{brokers.map((b) => <option key={b} value={b} />)}</datalist>
          </Field>
          <Field label={T(lang, "Année fiscale", "Fiscal year")}>
            <input type="number" value={form.fiscal_year} onChange={(e) => set("fiscal_year", Number(e.target.value))}
              className="rounded-lg px-2 py-1.5 text-[12px] w-full tabular-nums" style={inputStyle} />
          </Field>
          <Field label="Section">
            <select value={form.section} onChange={(e) => set("section", e.target.value)}
              className="rounded-lg px-2 py-1.5 text-[12px] w-full" style={inputStyle}>
              {SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABELS[s]?.[lang] ?? s}</option>)}
            </select>
          </Field>
          <Field label={T(lang, "Libellé (dimension)", "Label (dimension)")}>
            <input value={form.dimension ?? ""} onChange={(e) => set("dimension", e.target.value)}
              placeholder={T(lang, "ex. Desjardins, Q1, base…", "e.g. Desjardins, Q1, base…")}
              className="rounded-lg px-2 py-1.5 text-[12px] w-full" style={inputStyle} />
          </Field>
          <Field label={T(lang, "Sous-libellé (terme)", "Sub-label (term)")}>
            <input value={form.sub_dimension ?? ""} onChange={(e) => set("sub_dimension", e.target.value)}
              placeholder="0 · 1 · 2 · 3 · 4 · 5 · Other"
              className="rounded-lg px-2 py-1.5 text-[12px] w-full" style={inputStyle} />
          </Field>
          <Field label={T(lang, "Rang", "Rank")}>
            <input type="number" value={String(form.rank ?? "")} onChange={(e) => set("rank", e.target.value === "" ? null : Number(e.target.value))}
              className="rounded-lg px-2 py-1.5 text-[12px] w-full tabular-nums" style={inputStyle} />
          </Field>

          <Field label="Volume CY">{num("cy_volume")}</Field>
          <Field label="Volume PY">{num("py_volume")}</Field>
          <Field label={T(lang, "Dossiers CY", "Deals CY")}>{num("cy_deals")}</Field>
          <Field label={T(lang, "Dossiers PY", "Deals PY")}>{num("py_deals")}</Field>
          <Field label="Commission CY">{num("cy_commission")}</Field>
          <Field label="Commission PY">{num("py_commission")}</Field>
        </div>

        <Field label={T(lang, "Champs additionnels (JSON)", "Extra fields (JSON)")}>
          <textarea
            defaultValue={JSON.stringify(form.extra ?? {}, null, 0)}
            onBlur={(e) => {
              try { set("extra", e.target.value.trim() ? JSON.parse(e.target.value) : {}); setErr(null); }
              catch { setErr(T(lang, "JSON invalide dans les champs additionnels.", "Invalid JSON in extra fields.")); }
            }}
            rows={2}
            className="rounded-lg px-2 py-1.5 text-[11px] font-mono w-full mt-3" style={inputStyle} />
        </Field>

        {err && <p className="mt-3" style={{ fontSize: 11.5, color: "#E84C4C" }}>{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px]"
            style={{ border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-muted)" }}>
            {T(lang, "Annuler", "Cancel")}
          </button>
          <button onClick={() => void submit()} disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[12px] text-white flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: "var(--pp-brand-accent-2)" }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {T(lang, "Enregistrer", "Save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
