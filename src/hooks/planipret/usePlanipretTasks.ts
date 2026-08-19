import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  bucketTasks,
  clearTaskCache,
  createTask as apiCreate,
  deleteTask as apiDelete,
  listTasks,
  loadTaskCache,
  saveTaskCache,
  updateTask as apiUpdate,
  type NormalizedTask,
  type TaskSource,
} from "@/lib/planipret/tasks";

export interface UsePlanipretTasks {
  tasks: NormalizedTask[];
  buckets: { overdue: NormalizedTask[]; today: NormalizedTask[]; upcoming: NormalizedTask[] };
  openCount: number;
  loading: boolean;
  refreshing: boolean;
  source: TaskSource;
  error: string | null;
  message: string | null;
  refresh: () => Promise<void>;
  create: (input: Record<string, unknown>) => Promise<any>;
  update: (taskId: string, changes: Record<string, unknown>) => Promise<any>;
  remove: (taskId: string) => Promise<any>;
}

export function usePlanipretTasks(userId: string | null | undefined): UsePlanipretTasks {
  const [tasks, setTasks] = useState<NormalizedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<TaskSource>("projection");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);

  // Paint the per-user cache immediately.
  useEffect(() => {
    if (!userId) return;
    const cached = loadTaskCache(userId);
    if (cached.length) { setTasks(cached); setLoading(false); }
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const gen = ++generation.current;
    setRefreshing(true);
    const res = await listTasks({ status: "pending", limit: 50 });
    if (gen !== generation.current) return; // stale identity/response
    setRefreshing(false);
    setLoading(false);
    setSource(res.source);
    setError(res.success ? (res.source === "unavailable" ? res.error ?? null : null) : res.error ?? "load_failed");
    setMessage(res.message ?? null);
    if (res.success && res.source !== "unavailable") {
      setTasks(res.tasks);
      saveTaskCache(userId, res.tasks);
    } else if (res.source === "unavailable") {
      setTasks([]);
      clearTaskCache(userId);
    }
  }, [userId]);

  useEffect(() => { if (userId) void refresh(); }, [userId, refresh]);

  // Realtime: AVA (or another device) mutated a task.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`pp-tasks:${userId}`)
      .on("broadcast", { event: "tasks" }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, refresh]);

  const create = useCallback(async (input: Record<string, unknown>) => {
    const r = await apiCreate(input);
    if (r?.success) await refresh();
    return r;
  }, [refresh]);

  const update = useCallback(async (taskId: string, changes: Record<string, unknown>) => {
    const previous = tasks;
    // Optimistic, reversible.
    setTasks((cur) => cur.map((t) => (t.id === taskId ? { ...t, ...(changes.date || changes.due_at ? { due_at: new Date(String(changes.date ?? changes.due_at)).toISOString() } : {}), ...(changes.notes ? { notes: String(changes.notes) } : {}) } : t)));
    const r = await apiUpdate(taskId, changes);
    if (!r?.success) setTasks(previous); else await refresh();
    return r;
  }, [tasks, refresh]);

  const remove = useCallback(async (taskId: string) => {
    const previous = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== taskId));
    const r = await apiDelete(taskId);
    if (!r?.success) setTasks(previous); else await refresh();
    return r;
  }, [tasks, refresh]);

  const buckets = useMemo(() => bucketTasks(tasks), [tasks]);
  const openCount = buckets.overdue.length + buckets.today.length + buckets.upcoming.length;

  return { tasks, buckets, openCount, loading, refreshing, source, error, message, refresh, create, update, remove };
}
