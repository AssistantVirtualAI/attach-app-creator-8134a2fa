import { describe, expect, it } from "vitest";
import { readTomorrowTasks, tomorrowTasks } from "../../supabase/functions/_shared/daily-report-tasks";
const start = "2026-10-31T04:00:00Z", end = "2026-11-01T04:00:00Z";
describe("tomorrow's broker tasks", () => {
  it("includes only open tasks in Toronto tomorrow", () => {
    expect(tomorrowTasks([
      { notes: "Today", due_at: "2026-10-31T03:59:59Z" },
      { notes: "Tomorrow", due_at: start },
      { notes: "Later", due_at: end },
      { notes: "Closed", due_at: start, status: "complete" },
    ], start, end)).toEqual([{ title: "Tomorrow", due: start }]);
  });
  it("reads all authorized pages before summarizing", async () => {
    const pages: number[] = [];
    const result = await readTomorrowTasks(async page => { pages.push(page); return { success: true, source: "api", tasks: [{ id: String(page), notes: String(page), due_at: start }], has_more: page === 1 }; }, start, end);
    expect(pages).toEqual([1, 2]); expect(result.tasks).toHaveLength(2); expect(result.unavailable).toBe(false);
  });
  it("never describes a truncated or stale task list as complete", async () => {
    expect(await readTomorrowTasks(async () => ({ success: true, source: "api", upstream_truncated: true, tasks: [] }), start, end)).toEqual({ tasks: [], unavailable: true });
    expect(await readTomorrowTasks(async () => ({ success: true, source: "projection", tasks: [] }), start, end)).toEqual({ tasks: [], unavailable: true });
  });
});