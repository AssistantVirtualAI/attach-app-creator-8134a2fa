import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toApiDateTime } from "@/lib/planipret/tasks";

export interface TaskComposerValue {
  target: string;
  target_type: "user" | "contract";
  notes: string;
  due_at: string;
  description?: string;
  sync_calendar?: boolean;
  notification?: boolean;
  recurrence?: { value: number; pattern: string } | null;
}

interface Props {
  open: boolean;
  lang: "fr" | "en";
  defaultTarget?: string | null;
  busy?: boolean;
  initial?: Partial<TaskComposerValue> & { task_id?: string };
  /** Per-field validation errors returned by the gateway (HTTP 422). */
  fieldErrors?: Record<string, string> | null;
  onClose: () => void;
  onSubmit: (value: TaskComposerValue) => void | Promise<void>;
}

function defaultDue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const iso = toApiDateTime(d) ?? "";
  return iso.replace(" ", "T").slice(0, 16);
}

const FIELD_ERROR_LABELS: Record<string, { fr: string; en: string }> = {
  xid_required: { fr: "Cible (xid) requise.", en: "Target (xid) is required." },
  target_required: { fr: "Cible (xid) requise.", en: "Target (xid) is required." },
  notes_required: { fr: "La note est obligatoire.", en: "Notes are required." },
  date_required: { fr: "Date et heure requises.", en: "Date and time are required." },
  invalid_date: { fr: "Format de date invalide.", en: "Invalid date format." },
  type_must_be_user_or_contract: { fr: "Type de cible invalide.", en: "Invalid target type." },
};

export default function TaskComposerSheet({ open, lang, defaultTarget, busy, initial, fieldErrors, onClose, onSubmit }: Props) {
  const L = (fr: string, en: string) => (lang === "en" ? en : fr);
  const [targetType, setTargetType] = useState<"user" | "contract">((initial?.target_type as any) ?? "user");
  const [target, setTarget] = useState(initial?.target ?? defaultTarget ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [due, setDue] = useState(initial?.due_at ?? defaultDue());
  const [syncCal, setSyncCal] = useState(false);
  const [notify, setNotify] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [pattern, setPattern] = useState("week");
  const [recValue, setRecValue] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setTarget(initial?.target ?? defaultTarget ?? "");
    setNotes(initial?.notes ?? "");
    setDescription(initial?.description ?? "");
    setDue(initial?.due_at ?? defaultDue());
  }, [open, initial, defaultTarget]);

  if (!open) return null;

  const fieldMsg = (...keys: string[]) => {
    if (!fieldErrors) return null;
    for (const k of keys) {
      const raw = fieldErrors[k];
      if (!raw) continue;
      const known = FIELD_ERROR_LABELS[raw];
      return known ? (lang === "en" ? known.en : known.fr) : raw;
    }
    return null;
  };

  const FieldError = ({ keys }: { keys: string[] }) => {
    const msg = fieldMsg(...keys);
    if (!msg) return null;
    return <span className="text-[11px] block mt-1" role="alert" style={{ color: "var(--pp-danger)" }}>{msg}</span>;
  };

  const submit = async () => {
    if (!target.trim()) return setErr(L("Cible (xid) requise.", "Target (xid) is required."));
    if (!notes.trim()) return setErr(L("La note est obligatoire.", "Notes are required."));
    if (!due) return setErr(L("Date et heure requises.", "Date and time are required."));
    setErr(null);
    await onSubmit({
      target: target.trim(),
      target_type: targetType,
      notes: notes.trim(),
      due_at: due,
      description: description.trim() || undefined,
      sync_calendar: syncCal,
      notification: notify,
      recurrence: recurring ? { value: recValue, pattern } : null,
    });
  };

  const field = "w-full rounded-xl px-3 py-3 text-sm";
  const fieldStyle = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" } as const;

  return (
    <div className="fixed inset-0 z-[70] flex items-end" role="dialog" aria-modal="true" aria-label={L("Nouvelle tâche", "New task")}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose} />
      <div
        className="relative w-full rounded-t-3xl p-4 max-h-[88vh] overflow-y-auto"
        style={{ background: "var(--pp-bg-base, #fff)", paddingBottom: "calc(1rem + env(safe-area-inset-bottom))", WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold pp-heading">{initial?.task_id ? L("Modifier la tâche", "Edit task") : L("Nouvelle tâche", "New task")}</h2>
          <button onClick={onClose} aria-label={L("Fermer", "Close")} className="w-11 h-11 rounded-xl flex items-center justify-center" style={fieldStyle}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(["user", "contract"] as const).map((tt) => (
              <button key={tt} onClick={() => setTargetType(tt)}
                aria-pressed={targetType === tt}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-medium"
                style={targetType === tt
                  ? { background: "var(--pp-brand-accent)", color: "#fff" }
                  : fieldStyle}>
                {tt === "user" ? L("Utilisateur", "User") : L("Contrat", "Contract")}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>{L("Cible (xid Planiprêt)", "Target (Planiprêt xid)")}</span>
            <input className={field} style={fieldStyle} inputMode="numeric" value={target}
              aria-label={L("Cible xid", "Target xid")}
              onChange={(e) => setTarget(e.target.value)} placeholder="387460525" />
            <FieldError keys={["xid", "target"]} />
          </label>

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>{L("Note *", "Notes *")}</span>
            <input className={field} style={fieldStyle} value={notes} aria-label={L("Note", "Notes")}
              onChange={(e) => setNotes(e.target.value)} placeholder={L("Rappeler Jean", "Call Jean back")} />
            <FieldError keys={["notes"]} />
          </label>

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>{L("Échéance (America/Toronto) *", "Due (America/Toronto) *")}</span>
            <input type="datetime-local" className={field} style={fieldStyle} value={due}
              aria-label={L("Échéance", "Due date")} onChange={(e) => setDue(e.target.value)} />
            <FieldError keys={["date", "due_at"]} />
          </label>

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>{L("Description (optionnel)", "Description (optional)")}</span>
            <textarea className={field} style={fieldStyle} rows={2} value={description}
              aria-label={L("Description", "Description")} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <Toggle label={L("Créer l'événement calendrier", "Create calendar event")} checked={syncCal} onChange={setSyncCal} />
          <Toggle label={L("Envoyer une notification", "Send a notification")} checked={notify} onChange={setNotify} />
          <Toggle label={L("Tâche récurrente", "Recurring task")} checked={recurring} onChange={setRecurring} />

          {recurring && (
            <div className="flex gap-2">
              <input type="number" min={1} className={field} style={fieldStyle} value={recValue}
                aria-label={L("Valeur de récurrence", "Recurrence value")}
                onChange={(e) => setRecValue(Math.max(1, Number(e.target.value) || 1))} />
              <select className={field} style={fieldStyle} value={pattern} aria-label={L("Fréquence", "Pattern")}
                onChange={(e) => setPattern(e.target.value)}>
                <option value="day">{L("Jour", "Day")}</option>
                <option value="week">{L("Semaine", "Week")}</option>
                <option value="month">{L("Mois", "Month")}</option>
                <option value="year">{L("Année", "Year")}</option>
              </select>
            </div>
          )}

          {err && <p className="text-xs" role="alert" style={{ color: "var(--pp-danger)" }}>{err}</p>}

          <button onClick={submit} disabled={busy}
            className="w-full min-h-[48px] rounded-xl font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--pp-brand-accent)" }}>
            {busy ? L("Enregistrement…", "Saving…") : L("Enregistrer", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="w-full min-h-[44px] flex items-center justify-between rounded-xl px-3 text-sm"
      style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}>
      <span>{label}</span>
      <span className="w-10 h-6 rounded-full flex items-center px-0.5"
        style={{ background: checked ? "var(--pp-brand-accent)" : "var(--pp-bg-border)" }}>
        <span className="w-5 h-5 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }} />
      </span>
    </button>
  );
}
