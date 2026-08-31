import { useEffect, useMemo, useState } from "react";
import { CheckSquare, History, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { usePlanipretTasks } from "@/hooks/planipret/usePlanipretTasks";
import MaestroTaskRow from "@/components/planipret/mobile/MaestroTaskRow";
import { formatTaskDue, taskHistory, type NormalizedTask, type TaskHistoryEvent } from "@/lib/planipret/tasks";

interface BrokerOption { id: string; name: string }

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

/**
 * Vue Maestro exacte des tâches pour les admins : filtre par courtier, par
 * statut et par échéance, avec l'historique de chaque tâche. Lecture seule —
 * les mêmes colonnes que la page Tâches de Maestro.
 */
export default function PAMaestroTasks() {
  const { lang } = useMplanipretLang();
  const isEn = lang === "en";
  const L = (fr: string, en: string) => (isEn ? en : fr);

  const [userId, setUserId] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [broker, setBroker] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "done">("all");
  const [due, setDue] = useState<"all" | "overdue" | "today" | "upcoming">("all");
  const [history, setHistory] = useState<null | { task: NormalizedTask; events: TaskHistoryEvent[] | null }>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      if (!alive) return;
      setUserId(uid);
      const { data: rows } = await supabase
        .from("planipret_profiles")
        .select("full_name, email, maestro_broker_id")
        .not("maestro_broker_id", "is", null)
        .order("full_name", { ascending: true });
      if (!alive) return;
      const seen = new Set<string>();
      const opts: BrokerOption[] = [];
      for (const r of (rows ?? []) as any[]) {
        const id = String(r.maestro_broker_id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        opts.push({ id, name: r.full_name || r.email || `#${id}` });
      }
      setBrokers(opts);
    })();
    return () => { alive = false; };
  }, []);

  const { tasks, buckets, loading, refreshing, lastSyncAt, refresh } = usePlanipretTasks(userId, {
    brokerId: broker || null,
  });

  const rows = useMemo(() => {
    let list: NormalizedTask[] = tasks;
    if (due === "overdue") list = buckets.overdue;
    else if (due === "today") list = buckets.today;
    else if (due === "upcoming") list = buckets.upcoming;
    if (status !== "all") {
      list = list.filter((t) => {
        const closed = DONE.has(String(t.status ?? "").toLowerCase());
        return status === "done" ? closed : !closed;
      });
    }
    return [...list].sort((a, b) => new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime());
  }, [tasks, buckets, due, status]);

  const openHistory = async (task: NormalizedTask) => {
    setHistory({ task, events: null });
    const events = await taskHistory(task.id);
    setHistory((h) => (h && h.task.id === task.id ? { task, events } : h));
  };

  const selectStyle = {
    background: "var(--pp-bg-surface)",
    border: "1px solid var(--pp-bg-border)",
    color: "var(--pp-text-primary)",
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<CheckSquare className="w-5 h-5" />}
        title={L("Tâches Maestro", "Maestro tasks")}
        subtitle={L(
          "Vue Maestro exacte — filtrez par courtier, statut et échéance, et consultez l'historique de chaque tâche.",
          "Exact Maestro view — filter by broker, status and due date, and review each task's history.",
        )}
        actions={
          <button
            onClick={() => void refresh()}
            className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5"
            style={selectStyle}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {L("Actualiser", "Refresh")}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={L("Courtier", "Broker")} value={broker} onChange={(e) => setBroker(e.target.value)}
          className="min-h-[36px] rounded-lg px-2 text-xs" style={selectStyle}>
          <option value="">{L("Mes tâches", "My tasks")}</option>
          {brokers.map((b) => <option key={b.id} value={b.id}>{b.name} · #{b.id}</option>)}
        </select>

        <select aria-label={L("Statut", "Status")} value={status} onChange={(e) => setStatus(e.target.value as any)}
          className="min-h-[36px] rounded-lg px-2 text-xs" style={selectStyle}>
          <option value="all">{L("Tous les statuts", "All statuses")}</option>
          <option value="open">{L("En attente", "Pending")}</option>
          <option value="done">{L("Complétées", "Completed")}</option>
        </select>

        <select aria-label={L("Échéance", "Due")} value={due} onChange={(e) => setDue(e.target.value as any)}
          className="min-h-[36px] rounded-lg px-2 text-xs" style={selectStyle}>
          <option value="all">{L("Toutes les échéances", "All due dates")}</option>
          <option value="overdue">{L("En retard", "Overdue")}</option>
          <option value="today">{L("Aujourd'hui", "Today")}</option>
          <option value="upcoming">{L("À venir", "Upcoming")}</option>
        </select>

        <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>
          {rows.length} {L("tâches", "tasks")}
          {lastSyncAt && ` · ${L("dernière synchro", "last sync")} ${new Date(lastSyncAt).toLocaleTimeString(isEn ? "en-CA" : "fr-CA", { timeZone: "America/Toronto" })}`}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "#E2E8F0" }} />)}</div>
      ) : rows.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: "var(--pp-text-muted)" }}>
          {L("Aucune tâche pour ces filtres.", "No task for these filters.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((task) => (
            <li key={task.id} className="rounded-lg px-2 py-2" style={{ background: "#F7F9FC" }}>
              <MaestroTaskRow
                task={task}
                lang={isEn ? "en" : "fr"}
                syncedAt={(task as any)?.raw?.updated_at ?? lastSyncAt}
                actions={
                  <button
                    onClick={() => void openHistory(task)}
                    aria-label={L("Historique", "History")}
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ color: "var(--pp-text-muted)" }}
                  >
                    <History className="w-3.5 h-3.5" />
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {history && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setHistory(null)} />
          <div className="relative w-full max-w-md rounded-2xl p-4" style={{ background: "var(--pp-bg-base,#fff)" }}>
            <p className="text-sm font-semibold mb-0.5">{L("Historique", "History")}</p>
            <p className="text-[11px] mb-3" style={{ color: "var(--pp-text-muted)" }}>
              {history.task.notes} · {formatTaskDue(history.task.due_at, isEn ? "en" : "fr")}
            </p>
            {history.events === null ? (
              <p className="text-xs py-4 text-center inline-flex items-center gap-2" style={{ color: "var(--pp-text-muted)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {L("Chargement…", "Loading…")}
              </p>
            ) : history.events.length === 0 ? (
              <p className="text-xs py-3 text-center" style={{ color: "var(--pp-text-muted)" }}>
                {L("Aucun événement enregistré.", "No recorded event.")}
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {history.events.map((e) => (
                  <li key={e.id} className="rounded-lg px-2.5 py-2 text-[11.5px]" style={{ background: "#F7F9FC" }}>
                    <span className="font-semibold">{e.action}</span>
                    <span style={{ color: "var(--pp-text-muted)" }}>
                      {" · "}{new Date(e.created_at).toLocaleString(isEn ? "en-CA" : "fr-CA", { timeZone: "America/Toronto" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setHistory(null)} className="mt-3 w-full min-h-[40px] rounded-xl text-sm" style={selectStyle}>
              {L("Fermer", "Close")}
            </button>
          </div>
        </div>
      )}
    </PAPage>
  );
}
