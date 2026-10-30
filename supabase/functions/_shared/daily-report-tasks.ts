export function tomorrowTasks(tasks: any[], start: string, end: string) {
  const from = Date.parse(start), to = Date.parse(end);
  return tasks.filter(task => {
    const due = Date.parse(task.due_at ?? "");
    return Number.isFinite(due) && due >= from && due < to && !["complete", "completed", "done", "cancelled"].includes(String(task.status ?? "").toLowerCase());
  }).map(task => ({ title: task.notes || task.description || task.target_name || "Tâche", due: task.due_at }));
}
export async function readTomorrowTasks(read: (page: number) => Promise<any>, start: string, end: string) {
  const all = new Map<string, any>();
  for (let page = 1; page <= 20; page++) {
    const data = await read(page);
    if (!data?.success || data.source !== "api" || data.upstream_truncated || !Array.isArray(data.tasks)) return { tasks: [], unavailable: true };
    for (const task of data.tasks) all.set(String(task.id), task);
    if (!data.has_more) return { tasks: tomorrowTasks([...all.values()], start, end), unavailable: false };
  }
  return { tasks: [], unavailable: true };
}