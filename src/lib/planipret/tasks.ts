// Mobile-side task helpers. Pure logic lives in the shared module used by the
// edge function so the client and the server never disagree on formatting.
export * from "../../../supabase/functions/_shared/planipret-tasks";

import { supabase } from "@/integrations/supabase/client";
import type { NormalizedTask, TaskBuckets } from "../../../supabase/functions/_shared/planipret-tasks";

export type TaskSource = "api" | "projection" | "unavailable";

export interface TaskListResult {
  success: boolean;
  source: TaskSource;
  tasks: NormalizedTask[];
  buckets: TaskBuckets;
  overdue_count: number;
  error?: string;
  message?: string;
}

async function invoke(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke("planipret-task-api", { body });
  if (error) return { success: false, error: "network_error", message: error.message };
  return data ?? { success: false, error: "empty_response" };
}

export async function listTasks(opts: { status?: string; from?: string; to?: string; limit?: number } = {}): Promise<TaskListResult> {
  const d = await invoke({ action: "list", ...opts });
  return {
    success: !!d?.success,
    source: (d?.source ?? "unavailable") as TaskSource,
    tasks: Array.isArray(d?.tasks) ? d.tasks : [],
    buckets: d?.buckets ?? { overdue: [], today: [], upcoming: [] },
    overdue_count: d?.overdue_count ?? 0,
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
