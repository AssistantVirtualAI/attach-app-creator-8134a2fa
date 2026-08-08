import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Calendar, Video, ExternalLink, Plus, X, Loader2, RefreshCw, Trash2, Pencil } from "lucide-react";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { fmtDateTime } from "@/lib/planipret/brokerFormat";

type Lang = "fr" | "en";

const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";

export default function CalendarPanel({ lang }: { lang: Lang }) {
  const en = lang === "en";
  const [range, setRange] = useState(7);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const [form, setForm] = useState<null | { id?: string; subject: string; start: string; end: string; attendees: string; body: string; online: boolean }>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const start = new Date().toISOString();
    const end = new Date(Date.now() + range * 86400000).toISOString();
    const { data } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "list_calendar_events", payload: { start, end, top: 50 } },
    });
    const res = (data as any) ?? {};
    setNotConnected(res.connected === false || res.error === "ms365_not_connected");
    setEvents(res.events ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [range]);

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of events) {
      const key = String(e.start?.dateTime ?? "").slice(0, 10) || "—";
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    return Array.from(m.entries());
  }, [events]);

  const openNew = () => {
    const s = new Date(Date.now() + 3600000);
    const e = new Date(Date.now() + 5400000);
    setForm({ subject: "", start: toLocalInput(s.toISOString()), end: toLocalInput(e.toISOString()), attendees: "", body: "", online: true });
  };
  const openEdit = (ev: any) => setForm({
    id: ev.id, subject: ev.subject ?? "",
    start: toLocalInput(ev.start?.dateTime), end: toLocalInput(ev.end?.dateTime),
    attendees: (ev.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean).join(", "),
    body: ev.bodyPreview ?? "", online: Boolean(ev.isOnlineMeeting),
  });

  const save = async () => {
    if (!form) return;
    if (!form.subject.trim() || !form.start || !form.end) {
      toast.error(en ? "Subject, start and end are required" : "Objet, début et fin requis"); return;
    }
    setSaving(true);
    const payload: any = {
      subject: form.subject.trim(),
      start: { dateTime: form.start, timeZone: tz },
      end: { dateTime: form.end, timeZone: tz },
      body: form.body,
      attendees: form.attendees.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
      isOnlineMeeting: form.online,
    };
    if (form.id) payload.event_id = form.id;
    const { data, error } = await supabase.functions.invoke("ms365-actions", {
      body: { action: form.id ? "update_calendar_event" : "create_calendar_event", payload },
    });
    setSaving(false);
    const res = (data as any) ?? {};
    if (error || !res.success) { toast.error(res.error || error?.message || (en ? "Save failed" : "Échec de l'enregistrement")); return; }
    toast.success(form.id ? (en ? "Meeting updated" : "Réunion mise à jour") : (en ? "Meeting created" : "Réunion créée"));
    setForm(null); void load();
  };

  const remove = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "delete_calendar_event", payload: { event_id: id } },
    });
    const res = (data as any) ?? {};
    if (error || !res.success) { toast.error(res.error || error?.message || (en ? "Delete failed" : "Suppression impossible")); return; }
    toast.success(en ? "Meeting deleted" : "Réunion supprimée");
    void load();
  };

  if (notConnected) {
    return <div className="pp-card"><PPEmptyState icon={<Calendar className="w-5 h-5" />}
      title={en ? "Microsoft 365 not connected" : "Microsoft 365 non connecté"}
      description={en ? "Connect your account from Settings." : "Connectez votre compte dans Réglages."} /></div>;
  }

  return (
    <>
      <div className="pp-card flex flex-wrap items-center gap-2" style={{ padding: 12 }}>
        <select value={range} onChange={(e) => setRange(Number(e.target.value))} className="pp-input" style={{ fontSize: 12 }}>
          <option value={1}>{en ? "Today" : "Aujourd'hui"}</option>
          <option value={7}>{en ? "Next 7 days" : "7 prochains jours"}</option>
          <option value={30}>{en ? "Next 30 days" : "30 prochains jours"}</option>
          <option value={90}>{en ? "Next 90 days" : "90 prochains jours"}</option>
        </select>
        <button onClick={() => void load()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
          <RefreshCw className="w-3.5 h-3.5" />{en ? "Refresh" : "Actualiser"}
        </button>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white"
          style={{ background: "var(--pp-brand-accent-2)" }}>
          <Plus className="w-3.5 h-3.5" />{en ? "New meeting" : "Nouvelle réunion"}
        </button>
      </div>

      {loading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-12 w-full" />)}</div>
      ) : events.length === 0 ? (
        <div className="pp-card"><PPEmptyState icon={<Calendar className="w-5 h-5" />} title={en ? "No meetings" : "Aucune réunion"} /></div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([day, list]) => (
            <div key={day} className="pp-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)", marginBottom: 8 }}>
                {new Date(`${day}T12:00:00`).toLocaleDateString(en ? "en-CA" : "fr-CA", { weekday: "long", day: "numeric", month: "long" })}
              </div>
              <div className="space-y-2">
                {list.map((ev) => (
                  <div key={ev.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{ev.subject || "—"}</div>
                      <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                        {fmtDateTime(ev.start?.dateTime, lang)} → {fmtDateTime(ev.end?.dateTime, lang)} · {(ev.attendees ?? []).length} {en ? "attendees" : "participants"}
                      </div>
                      {ev.location?.displayName && (
                        <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{ev.location.displayName}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ev.isOnlineMeeting && ev.onlineMeeting?.joinUrl && (
                        <a href={ev.onlineMeeting.joinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ fontSize: 11.5, color: "var(--pp-brand-accent-2)" }}>
                          <Video className="w-3.5 h-3.5" />{en ? "Join" : "Joindre"}<ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button onClick={() => openEdit(ev)} title={en ? "Edit" : "Modifier"}><Pencil className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} /></button>
                      <button onClick={() => void remove(ev.id)} title={en ? "Delete" : "Supprimer"}><Trash2 className="w-3.5 h-3.5" style={{ color: "#dc2626" }} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setForm(null)}>
          <div className="pp-card w-full max-w-lg" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <h3 className="pp-heading" style={{ fontSize: 15.5, fontWeight: 700 }}>
                {form.id ? (en ? "Edit meeting" : "Modifier la réunion") : (en ? "New meeting" : "Nouvelle réunion")}
              </h3>
              <button onClick={() => setForm(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            <div className="space-y-2">
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="pp-input w-full" style={{ fontSize: 13 }}
                placeholder={en ? "Subject" : "Objet"} />
              <div className="grid grid-cols-2 gap-2">
                <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="pp-input w-full" style={{ fontSize: 13 }} />
                <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="pp-input w-full" style={{ fontSize: 13 }} />
              </div>
              <input value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} className="pp-input w-full" style={{ fontSize: 13 }}
                placeholder={en ? "Attendees (emails, comma separated)" : "Participants (courriels, séparés par des virgules)"} />
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} className="pp-input w-full" style={{ fontSize: 13, resize: "vertical" }}
                placeholder={en ? "Agenda / notes" : "Ordre du jour / notes"} />
              <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
                <input type="checkbox" checked={form.online} onChange={(e) => setForm({ ...form, online: e.target.checked })} />
                {en ? "Teams online meeting" : "Réunion Teams en ligne"}
              </label>
            </div>
            <div className="flex justify-end" style={{ marginTop: 12 }}>
              <button onClick={() => void save()} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--pp-brand-accent-2)" }}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}{en ? "Save" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
