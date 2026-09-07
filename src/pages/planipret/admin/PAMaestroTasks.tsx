import { useEffect, useMemo, useState } from "react";
import { CheckSquare, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

/**
 * Suivi des tâches Maestro : statut, dates, dossier (client), qui a assigné et
 * à qui, avec avancement par dossier. Lecture temps réel de la projection —
 * aucune donnée inventée, tout provient de Maestro.
 */

interface Row {
  id: string;
  task_id: string;
  user_id: string | null;
  status: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  payload: any;
}

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);
const isDone = (s?: string | null) => DONE.has(String(s ?? "").toLowerCase());

const name = (first?: any, last?: any) =>
  [first, last].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ").trim();

export default function PAMaestroTasks() {
  const { lang } = useMplanipretLang();
  const isEn = lang === "en";
  const L = (fr: string, en: string) => (isEn ? en : fr);
  const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString(isEn ? "en-CA" : "fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }) : "—";

  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | "open" | "overdue" | "done">("all");
  const [broker, setBroker] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("planipret_tasks_projection")
      .select("id, task_id, user_id, status, due_at, created_at, updated_at, payload")
      .is("deleted_at", null)
      .order("due_at", { ascending: true })
      .limit(1000);
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    void (async () => {
      const { data } = await supabase.from("planipret_profiles").select("user_id, full_name, email");
      const m: Record<string, string> = {};
      for (const p of (data ?? []) as any[]) if (p.user_id) m[p.user_id] = p.full_name || p.email || "";
      setNames(m);
    })();
    const ch = supabase
      .channel("pa-maestro-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "planipret_tasks_projection" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const items = useMemo(() => {
    const now = Date.now();
    return rows
      .map((r) => {
        const raw = r.payload?.raw ?? {};
        return {
          r,
          notes: String(r.payload?.notes ?? raw.notes ?? "—"),
          client: name(raw.client_first_name, raw.client_last_name) || String(r.payload?.target_name ?? "—"),
          assignedBy: name(raw.delegate_first_name, raw.delegate_last_name) || "—",
          assignedTo: name(raw.target_first_name, raw.target_last_name) || (r.user_id ? names[r.user_id] ?? "—" : "—"),
          overdue: !isDone(r.status) && !!r.due_at && new Date(r.due_at).getTime() < now,
        };
      })
      .filter((x) => {
        if (status === "done" && !isDone(x.r.status)) return false;
        if (status === "open" && isDone(x.r.status)) return false;
        if (status === "overdue" && !x.overdue) return false;
        if (broker && x.r.user_id !== broker) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!`${x.notes} ${x.client} ${x.assignedTo} ${x.assignedBy}`.toLowerCase().includes(q)) return false;
        }
        return true;
      });
  }, [rows, names, status, broker, search]);

  const byClient = useMemo(() => {
    const m = new Map<string, { total: number; done: number; overdue: number; next: string | null }>();
    for (const x of items) {
      const k = x.client || "—";
      const e = m.get(k) ?? { total: 0, done: 0, overdue: 0, next: null };
      e.total++;
      if (isDone(x.r.status)) e.done++;
      if (x.overdue) e.overdue++;
      if (!isDone(x.r.status) && x.r.due_at && (!e.next || x.r.due_at < e.next)) e.next = x.r.due_at;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12);
  }, [items]);

  const brokerOptions = useMemo(() => {
    const ids = new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]);
    return [...ids].map((id) => ({ id, label: names[id] ?? id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, names]);

  const ctl = { background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" };

  return (
    <PAPage>
      <PAPageHeader
        icon={<CheckSquare className="w-5 h-5" />}
        title={L("Suivi des tâches Maestro", "Maestro task tracking")}
        subtitle={L(
          "Statut, dates, dossier client, qui a assigné et à qui — mise à jour en temps réel.",
          "Status, dates, client file, who assigned and to whom — updated in real time.",
        )}
        actions={
          <button onClick={() => void load()} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={ctl}>
            <RefreshCw className="w-3.5 h-3.5" /> {L("Actualiser", "Refresh")}
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={L("Total", "Total")} value={items.length} />
        <Stat label={L("En cours", "Open")} value={items.filter((x) => !isDone(x.r.status)).length} />
        <Stat label={L("En retard", "Overdue")} value={items.filter((x) => x.overdue).length} color="#E84C4C" />
        <Stat label={L("Complétées", "Completed")} value={items.filter((x) => isDone(x.r.status)).length} color="#00D4AA" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={L("Statut", "Status")} value={status} onChange={(e) => setStatus(e.target.value as any)} className="min-h-[36px] rounded-lg px-2 text-xs" style={ctl}>
          <option value="all">{L("Tous les statuts", "All statuses")}</option>
          <option value="open">{L("En cours", "Open")}</option>
          <option value="overdue">{L("En retard", "Overdue")}</option>
          <option value="done">{L("Complétées", "Completed")}</option>
        </select>
        <select aria-label={L("Courtier", "Broker")} value={broker} onChange={(e) => setBroker(e.target.value)} className="min-h-[36px] rounded-lg px-2 text-xs" style={ctl}>
          <option value="">{L("Tous les courtiers", "All brokers")}</option>
          {brokerOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Rechercher un client ou une tâche", "Search a client or task")}
          className="min-h-[36px] rounded-lg px-2 text-xs flex-1 min-w-[200px]" style={ctl} />
      </div>

      <div className="pp-card p-4">
        <p className="text-xs mb-2" style={{ color: "var(--pp-text-muted)" }}>{L("Avancement par dossier", "Progress by file")}</p>
        {byClient.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--pp-text-faint)" }}>{L("Aucun dossier.", "No file.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byClient.map(([client, s]) => (
              <div key={client} className="rounded-lg p-2.5" style={{ background: "var(--pp-bg-elevated)" }}>
                <p className="text-xs font-medium truncate" style={{ color: "var(--pp-text-primary)" }}>{client}</p>
                <p className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>
                  {s.done}/{s.total} {L("complétées", "completed")}
                  {s.overdue > 0 && <span style={{ color: "#E84C4C" }}> · {s.overdue} {L("en retard", "overdue")}</span>}
                </p>
                <p className="text-[10px]" style={{ color: "var(--pp-text-faint)" }}>{L("Prochaine", "Next")}: {fmt(s.next)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pp-card pa-scroll">
        <table className="w-full text-sm">
          <thead style={{ background: "var(--pp-bg-elevated)" }}>
            <tr style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--pp-text-faint)" }} className="text-left">
              <th className="p-3">{L("Tâche", "Task")}</th>
              <th>{L("Dossier / client", "File / client")}</th>
              <th>{L("Assigné à", "Assigned to")}</th>
              <th>{L("Assigné par", "Assigned by")}</th>
              <th>{L("Statut", "Status")}</th>
              <th>{L("Échéance", "Due")}</th>
              <th>{L("Créée", "Created")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="p-3"><div className="h-3 w-3/4 animate-pulse rounded" style={{ background: "var(--pp-bg-elevated)" }} /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-xs" style={{ color: "var(--pp-text-muted)" }}>{L("Aucune tâche pour ces filtres.", "No task for these filters.")}</td></tr>
            ) : items.map((x) => (
              <tr key={x.r.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td className="p-3" style={{ color: "var(--pp-text-primary)" }}>{x.notes}</td>
                <td style={{ color: "var(--pp-text-secondary)" }}>{x.client}</td>
                <td style={{ color: "var(--pp-text-secondary)" }}>{x.assignedTo}</td>
                <td style={{ color: "var(--pp-text-muted)" }}>{x.assignedBy}</td>
                <td>
                  <span className="px-1.5 py-0.5 rounded" style={{
                    fontSize: 10,
                    color: isDone(x.r.status) ? "#00D4AA" : x.overdue ? "#E84C4C" : "#E8A33D",
                    border: `1px solid ${isDone(x.r.status) ? "#00D4AA" : x.overdue ? "#E84C4C" : "#E8A33D"}55`,
                  }}>
                    {isDone(x.r.status) ? L("Complétée", "Completed") : x.overdue ? L("En retard", "Overdue") : L("En cours", "Open")}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>{fmt(x.r.due_at)}</td>
                <td style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>{fmt(x.r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PAPage>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="pp-card p-3">
      <p className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>{label}</p>
      <p className="text-xl font-semibold" style={{ color: color ?? "var(--pp-text-primary)" }}>{value}</p>
    </div>
  );
}
