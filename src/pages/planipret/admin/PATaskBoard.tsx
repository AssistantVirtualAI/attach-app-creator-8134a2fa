import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckSquare, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

interface TaskRow {
  taskId: string;
  userId: string;
  brokerName: string;
  client: string;
  notes: string;
  status: string;
  done: boolean;
  dueAt: string | null;
  overdue: boolean;
}

interface BrokerAgg {
  userId: string;
  name: string;
  total: number;
  open: number;
  done: number;
  overdue: number;
  clients: number;
  nextDue: string | null;
  nextLabel: string;
}

/**
 * Tableau des tâches du portail admin : suivi par courtier (statut, clients,
 * retards, prochaine échéance) + liste filtrable de toutes les tâches.
 * Lecture seule, alimentée par la projection Maestro.
 */
export default function PATaskBoard() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [broker, setBroker] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "overdue" | "done">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const [proj, profiles] = await Promise.all([
        supabase.from("planipret_tasks_projection")
          .select("task_id, user_id, status, due_at, payload")
          .is("deleted_at", null)
          .order("due_at", { ascending: true })
          .limit(5000),
        supabase.from("planipret_profiles").select("user_id, full_name, email").limit(1000),
      ]);
      if (!alive) return;

      const nameBy = new Map<string, string>();
      for (const p of (profiles.data ?? []) as any[]) {
        nameBy.set(String(p.user_id), p.full_name || p.email || String(p.user_id).slice(0, 8));
      }

      const now = Date.now();
      const rows: TaskRow[] = ((proj.data ?? []) as any[]).map((r) => {
        const payload = (r.payload ?? {}) as any;
        const raw = payload.raw ?? {};
        const st = String(r.status ?? payload.status ?? "").toLowerCase();
        const done = DONE.has(st);
        const due = r.due_at ?? payload.due_at ?? null;
        return {
          taskId: String(r.task_id),
          userId: String(r.user_id),
          brokerName: nameBy.get(String(r.user_id)) ?? String(r.user_id).slice(0, 8),
          client: String(
            payload.target_name || raw.client_name || raw.contact_name || raw.customer_name || "",
          ).trim(),
          notes: String(payload.notes ?? raw.notes ?? "").trim(),
          status: st || (done ? "done" : "pending"),
          done,
          dueAt: due,
          overdue: !done && Boolean(due) && new Date(due).getTime() < now,
        };
      });
      setTasks(rows);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const brokers = useMemo(() => {
    const map = new Map<string, BrokerAgg>();
    for (const t of tasks) {
      const cur = map.get(t.userId) ?? {
        userId: t.userId, name: t.brokerName, total: 0, open: 0, done: 0, overdue: 0,
        clients: 0, nextDue: null, nextLabel: "",
      };
      cur.total += 1;
      if (t.done) cur.done += 1; else cur.open += 1;
      if (t.overdue) cur.overdue += 1;
      if (!t.done && t.dueAt && (!cur.nextDue || t.dueAt < cur.nextDue)) {
        cur.nextDue = t.dueAt;
        cur.nextLabel = t.client || t.notes;
      }
      map.set(t.userId, cur);
    }
    const clientsBy = new Map<string, Set<string>>();
    for (const t of tasks) {
      if (!t.client) continue;
      const set = clientsBy.get(t.userId) ?? new Set<string>();
      set.add(t.client.toLowerCase());
      clientsBy.set(t.userId, set);
    }
    const out = [...map.values()].map((b) => ({ ...b, clients: clientsBy.get(b.userId)?.size ?? 0 }));
    out.sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
    return out;
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (broker && t.userId !== broker) return false;
      if (status === "open" && t.done) return false;
      if (status === "done" && !t.done) return false;
      if (status === "overdue" && !t.overdue) return false;
      if (q && !`${t.client} ${t.notes} ${t.brokerName}`.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 500);
  }, [tasks, broker, status, query]);

  const totals = useMemo(() => ({
    total: tasks.length,
    open: tasks.filter((t) => !t.done).length,
    overdue: tasks.filter((t) => t.overdue).length,
    clients: new Set(tasks.filter((t) => t.client).map((t) => t.client.toLowerCase())).size,
  }), [tasks]);

  const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };
  const muted = { color: "var(--pp-text-muted)" };
  const fmt = (v: string | null) => (v
    ? new Date(v).toLocaleString(en ? "en-CA" : "fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" })
    : "—");

  return (
    <PAPage>
      <PAPageHeader
        icon={<CheckSquare className="w-5 h-5" />}
        title={L("Tableau des tâches", "Task board")}
        subtitle={L(
          "Suivi de toutes les tâches Maestro : statut, client, échéance et retards, par courtier.",
          "Track every Maestro task: status, client, due date and overdue items, by broker.",
        )}
        actions={
          <button onClick={() => setReloadKey((k) => k + 1)} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {L("Actualiser", "Refresh")}
          </button>
        }
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <PPSkeleton key={i} style={{ height: 56 }} />)}</div>
      ) : tasks.length === 0 ? (
        <PPEmptyState icon={<CheckSquare className="w-5 h-5" />} title={L("Aucune tâche", "No task")} />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={L("Tâches", "Tasks")} value={String(totals.total)} style={surface} />
            <Kpi label={L("Ouvertes", "Open")} value={String(totals.open)} style={surface} />
            <Kpi label={L("En retard", "Overdue")} value={String(totals.overdue)} style={surface} danger={totals.overdue > 0} />
            <Kpi label={L("Clients suivis", "Tracked clients")} value={String(totals.clients)} style={surface} />
          </div>

          {/* Suivi par courtier */}
          <div className="rounded-xl overflow-x-auto" style={surface}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                  <Th>{L("Courtier", "Broker")}</Th>
                  <Th>{L("Ouvertes", "Open")}</Th>
                  <Th>{L("En retard", "Overdue")}</Th>
                  <Th>{L("Complétées", "Completed")}</Th>
                  <Th>{L("Clients", "Clients")}</Th>
                  <Th>{L("Prochaine échéance", "Next due")}</Th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b) => (
                  <tr key={b.userId} className="cursor-pointer" onClick={() => setBroker(b.userId === broker ? "" : b.userId)}
                    style={{ borderBottom: "1px solid var(--pp-bg-border)", background: broker === b.userId ? "var(--pp-bg-elevated)" : undefined }}>
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2 font-semibold">{b.open}</td>
                    <td className="px-3 py-2" style={b.overdue ? { color: "#B91C1C", fontWeight: 600 } : undefined}>{b.overdue || "—"}</td>
                    <td className="px-3 py-2">{b.done}</td>
                    <td className="px-3 py-2">{b.clients}</td>
                    <td className="px-3 py-2">
                      {fmt(b.nextDue)}
                      {b.nextLabel && <p className="text-[10px]" style={muted}>{b.nextLabel}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Filtres + liste détaillée */}
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={L("Courtier", "Broker")} value={broker} onChange={(e) => setBroker(e.target.value)}
              className="min-h-[36px] rounded-lg px-2 text-xs" style={surface}>
              <option value="">{L("Tous les courtiers", "All brokers")}</option>
              {brokers.map((b) => <option key={b.userId} value={b.userId}>{b.name}</option>)}
            </select>
            <select aria-label={L("Statut", "Status")} value={status} onChange={(e) => setStatus(e.target.value as any)}
              className="min-h-[36px] rounded-lg px-2 text-xs" style={surface}>
              <option value="all">{L("Tous les statuts", "All statuses")}</option>
              <option value="open">{L("Ouvertes", "Open")}</option>
              <option value="overdue">{L("En retard", "Overdue")}</option>
              <option value="done">{L("Complétées", "Completed")}</option>
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              aria-label={L("Rechercher un client", "Search a client")}
              placeholder={L("Rechercher un client…", "Search a client…")}
              className="min-h-[36px] rounded-lg px-2 text-xs flex-1 min-w-[180px]" style={surface} />
            <span className="text-[11px]" style={muted}>{filtered.length} {L("tâches", "tasks")}</span>
          </div>

          <div className="rounded-xl overflow-x-auto" style={surface}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                  <Th>{L("Client", "Client")}</Th>
                  <Th>{L("Tâche", "Task")}</Th>
                  <Th>{L("Courtier", "Broker")}</Th>
                  <Th>{L("Statut", "Status")}</Th>
                  <Th>{L("Échéance", "Due")}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={`${t.userId}-${t.taskId}`} style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                    <td className="px-3 py-2 font-medium">{t.client || "—"}</td>
                    <td className="px-3 py-2">{t.notes || "—"}</td>
                    <td className="px-3 py-2">{t.brokerName}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={t.done
                          ? { background: "#10B9811A", color: "#047857" }
                          : t.overdue
                            ? { background: "#B91C1C1A", color: "#B91C1C" }
                            : { background: "#2563EB1A", color: "#1D4ED8" }}>
                        {t.overdue && !t.done && <AlertTriangle className="w-3 h-3" />}
                        {t.done ? L("Complétée", "Completed") : t.overdue ? L("En retard", "Overdue") : L("En attente", "Pending")}
                      </span>
                    </td>
                    <td className="px-3 py-2" style={t.overdue ? { color: "#B91C1C", fontWeight: 600 } : undefined}>{fmt(t.dueAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PAPage>
  );
}

function Kpi({ label, value, style, danger }: { label: string; value: string; style: React.CSSProperties; danger?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={style}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted)" }}>{label}</p>
      <p className="text-xl font-semibold mt-1" style={danger ? { color: "#B91C1C" } : undefined}>{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted)" }}>
      {children}
    </th>
  );
}
