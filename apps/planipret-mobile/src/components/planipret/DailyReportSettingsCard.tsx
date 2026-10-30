import { useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const TIMES = Array.from({ length: 31 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`;
});
const SECTIONS: Array<[string, string, string]> = [
  ["calls", "Appels et appels manqués", "Calls and missed calls"],
  ["voicemails", "Messages vocaux", "Voicemails"],
  ["texts", "Textos", "Texts"],
  ["emails", "Courriels (résumé IA)", "Emails (AI summary)"],
  ["agenda", "Rendez-vous et tâches de demain", "Tomorrow's appointments and tasks"],
];

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("ms365-actions", { body: { action, payload } });
  if (error) throw new Error((data as any)?.error ?? error.message);
  return data as any;
}

export default function DailyReportSettingsCard({ lang }: { lang: "fr" | "en" | string }) {
  const en = lang === "en";
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("17:00");
  const [sections, setSections] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  useEffect(() => {
    call("daily_report_settings")
      .then((d) => {
        if (!d?.success) { setUnavailable(d?.error ?? "Microsoft 365"); return; }
        setEnabled(d.enabled); setTime(d.time); setSections(d.sections ?? {}); setEmail(d.email);
      })
      .catch(() => setUnavailable(en ? "Connect Microsoft 365 to receive the daily summary." : "Connectez Microsoft 365 pour recevoir le résumé quotidien."))
      .finally(() => setLoading(false));
  }, [en]);

  const save = async (next: { enabled?: boolean; time?: string; sections?: Record<string, boolean> }) => {
    const body = { enabled, time, sections, ...next };
    setBusy("save");
    try {
      const d = await call("daily_report_settings", { save: true, ...body });
      if (!d?.success) throw new Error(d?.error);
      setEnabled(d.enabled); setTime(d.time); setSections(d.sections);
      toast.success(en ? "Saved" : "Enregistré");
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); } finally { setBusy(null); }
  };

  const sendTest = async () => {
    setBusy("test");
    try {
      const d = await call("daily_report", { day: new Date().getHours() < 12 ? "yesterday" : "today" });
      if (!d?.sent) throw new Error(d?.error ?? "Non envoyé");
      toast.success(en ? `Sample sent to ${d.to}` : `Exemple envoyé à ${d.to}`);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); } finally { setBusy(null); }
  };

  return (
    <div className="pp-card lg:col-span-2" style={{ padding: 16 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="pp-heading flex items-center gap-2" style={{ fontSize: 14, fontWeight: 700 }}>
            <Mail className="w-4 h-4" />{en ? "Daily email summary" : "Résumé quotidien par courriel"}
          </h2>
          <p style={{ fontSize: 12, color: "var(--pp-text-muted)", marginTop: 4 }}>
            {en ? "Calls, missed calls, voicemails, texts and emails of the day, with stats — sent only to you"
                : "Appels, manqués, messages vocaux, textos et courriels de la journée, avec statistiques — envoyé à vous seulement"}
            {email ? ` (${email})` : ""}.
          </p>
        </div>
        {!loading && !unavailable && (
          <Switch checked={enabled} disabled={busy !== null} onCheckedChange={(v) => void save({ enabled: v })} aria-label="Résumé quotidien" />
        )}
      </div>

      {loading ? <p style={{ fontSize: 13, marginTop: 12, color: "var(--pp-text-muted)" }}>…</p>
        : unavailable ? <p style={{ fontSize: 13, marginTop: 12, color: "var(--pp-text-muted)" }}>{unavailable}</p>
        : (
          <div className="grid gap-4 sm:grid-cols-2" style={{ marginTop: 14, opacity: enabled ? 1 : 0.6 }}>
            <label className="flex flex-col gap-1" style={{ fontSize: 13 }}>
              <span style={{ color: "var(--pp-text-muted)" }}>{en ? "Send time (every day)" : "Heure d'envoi (chaque jour)"}</span>
              <select value={time} disabled={busy !== null} onChange={(e) => void save({ time: e.target.value })}
                className="pp-input" style={{ fontSize: 13 }}>
                {TIMES.map((t) => <option key={t} value={t}>{t.replace(":", " h ")}</option>)}
              </select>
            </label>
            <div className="flex flex-col gap-2" style={{ fontSize: 13 }}>
              <span style={{ color: "var(--pp-text-muted)" }}>{en ? "Included sections" : "Sections incluses"}</span>
              {SECTIONS.map(([k, fr, enl]) => (
                <label key={k} className="flex items-center justify-between gap-2">
                  <span style={{ color: "var(--pp-text-primary)" }}>{en ? enl : fr}</span>
                  <Switch checked={sections[k] !== false} disabled={busy !== null}
                    onCheckedChange={(v) => void save({ sections: { ...sections, [k]: v } })} />
                </label>
              ))}
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => void sendTest()} disabled={busy !== null} className="inline-flex items-center gap-2">
                <Send className="w-4 h-4" />{busy === "test" ? "…" : en ? "Send me a sample now" : "M'envoyer un exemple maintenant"}
              </Button>
            </div>
          </div>
        )}
    </div>
  );
}
