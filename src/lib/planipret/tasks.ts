// Mobile-side task helpers. Pure logic lives in the shared module used by the
// edge function so the client and the server never disagree on formatting.
export * from "../../../supabase/functions/_shared/planipret-tasks";

import { supabase } from "@/integrations/supabase/client";
import type { NormalizedTask, TaskBuckets } from "../../../supabase/functions/_shared/planipret-tasks";

export type TaskSource = "api" | "projection" | "unavailable";

export type TaskFilterValue = "overdue" | "today" | "upcoming" | "open" | "all";

export interface TaskListResult {
  success: boolean;
  source: TaskSource;
  tasks: NormalizedTask[];
  buckets: TaskBuckets;
  overdue_count: number;
  counts: { overdue: number; today: number; upcoming: number; open: number; all: number };
  filter: TaskFilterValue;
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  error?: string;
  message?: string;
}

async function invoke(body: Record<string, unknown>): Promise<any> {
  // No session yet (boot / signed out): don't call the gateway, it would 401
  // and surface as a runtime error overlay.
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session?.access_token) {
    return { success: false, source: "unavailable", error: "unauthenticated" };
  }
  const { data, error } = await supabase.functions.invoke("planipret-task-api", { body });
  if (error) return { success: false, error: "network_error", message: error.message };
  return data ?? { success: false, error: "empty_response" };
}

export interface ListTaskOptions {
  status?: string;
  from?: string;
  to?: string;
  /** retard / aujourd'hui / à venir */
  filter?: TaskFilterValue;
  page?: number;
  limit?: number;
}

export async function listTasks(opts: ListTaskOptions = {}): Promise<TaskListResult> {
  const d = await invoke({ action: "list", ...opts });
  const tasks = Array.isArray(d?.tasks) ? d.tasks : [];
  return {
    success: !!d?.success,
    source: (d?.source ?? "unavailable") as TaskSource,
    tasks,
    buckets: d?.buckets ?? { overdue: [], today: [], upcoming: [] },
    overdue_count: d?.overdue_count ?? 0,
    counts: d?.counts ?? { overdue: 0, today: 0, upcoming: 0, open: tasks.length, all: tasks.length },
    filter: (d?.filter ?? opts.filter ?? "open") as TaskFilterValue,
    page: d?.page ?? opts.page ?? 1,
    limit: d?.limit ?? opts.limit ?? 20,
    total: d?.total ?? tasks.length,
    has_more: !!d?.has_more,
    error: d?.error,
    message: d?.message,
  };
}

export const getTask = (task_id: string) => invoke({ action: "get", task_id });

export const createTask = (input: Record<string, unknown>) =>
  invoke({ action: "create", ...input });

export const updateTask = (task_id: string, changes: Record<string, unknown>, idempotency_key?: string) =>
  invoke({ action: "update", task_id, changes, idempotency_key });

export const deleteTask = (task_id: string, idempotency_key?: string) =>
  invoke({ action: "delete", task_id, idempotency_key });

/** Local per-user cache so the home screen paints instantly. */
const cacheKey = (userId: string) => `pp_tasks_cache_${userId}`;

export function loadTaskCache(userId: string): NormalizedTask[] {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  } catch { return []; }
}

export function saveTaskCache(userId: string, tasks: NormalizedTask[]) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ tasks, at: Date.now() }));
  } catch { /* quota */ }
}

export function clearTaskCache(userId: string) {
  try { localStorage.removeItem(cacheKey(userId)); } catch { /* noop */ }
}
