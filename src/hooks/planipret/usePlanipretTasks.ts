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
  type TaskFilterValue,
  type TaskSource,
} from "@/lib/planipret/tasks";

const PAGE_SIZE = 20;

export interface UsePlanipretTasks {
  tasks: NormalizedTask[];
  buckets: { overdue: NormalizedTask[]; today: NormalizedTask[]; upcoming: NormalizedTask[] };
  counts: { overdue: number; today: number; upcoming: number; open: number; all: number };
  openCount: number;
  filter: TaskFilterValue;
  setFilter: (f: TaskFilterValue) => void;
  page: number;
  total: number;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [source, setSource] = useState<TaskSource>("projection");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilterState] = useState<TaskFilterValue>("open");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState({ overdue: 0, today: 0, upcoming: 0, open: 0, all: 0 });
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
    const res = await listTasks({ status: "pending", filter, page: 1, limit: PAGE_SIZE });
    if (gen !== generation.current) return; // stale identity/response
    setRefreshing(false);
    setLoading(false);
    setSource(res.source);
    setError(res.success ? (res.source === "unavailable" ? res.error ?? null : null) : res.error ?? "load_failed");
    setMessage(res.message ?? null);
    setCounts(res.counts);
    setPage(res.page);
    setTotal(res.total);
    setHasMore(res.has_more);
    if (res.success && res.source !== "unavailable") {
      setTasks(res.tasks);
      saveTaskCache(userId, res.tasks);
    } else if (res.source === "unavailable") {
      setTasks([]);
      clearTaskCache(userId);
    }
  }, [userId, filter]);

  const loadMore = useCallback(async () => {
    if (!userId || !hasMore || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    const next = page + 1;
    const res = await listTasks({ status: "pending", filter, page: next, limit: PAGE_SIZE });
    setLoadingMore(false);
    if (gen !== generation.current) return;
    if (!res.success) return;
    setPage(res.page);
    setTotal(res.total);
    setHasMore(res.has_more);
    setCounts(res.counts);
    setTasks((cur) => {
      const seen = new Set(cur.map((t) => t.id));
      return [...cur, ...res.tasks.filter((t) => !seen.has(t.id))];
    });
  }, [userId, filter, page, hasMore, loadingMore]);

  const setFilter = useCallback((f: TaskFilterValue) => {
    setFilterState(f);
    setPage(1);
  }, []);

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
  const openCount = counts.open || (buckets.overdue.length + buckets.today.length + buckets.upcoming.length);

  return {
    tasks, buckets, counts, openCount, filter, setFilter, page, total, hasMore,
    loadMore, loadingMore, loading, refreshing, source, error, message,
    refresh, create, update, remove,
  };
}
