import { describe, it, expect, beforeEach } from "vitest";
import {
  bucketTasks,
  formatTaskDue,
  toApiDateTime,
  type NormalizedTask,
} from "../../../supabase/functions/_shared/planipret-tasks";
import { loadTaskCache, saveTaskCache, clearTaskCache } from "@/lib/planipret/tasks";

const task = (id: string, due: Date | null): NormalizedTask => ({
  id, notes: `task ${id}`, due_at: due ? due.toISOString() : null,
} as NormalizedTask);

describe("planipret task helpers", () => {
  it("formats dates for the API in America/Toronto", () => {
    const out = toApiDateTime("2026-03-15T18:30:00.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("rejects invalid dates", () => {
    expect(toApiDateTime("not-a-date")).toBeNull();
  });

  it("buckets tasks into overdue / today / upcoming", () => {
    const now = new Date("2026-05-10T15:00:00-04:00");
    const b = bucketTasks([
      task("a", new Date("2026-05-08T10:00:00-04:00")),
      task("b", new Date("2026-05-10T20:00:00-04:00")),
      task("c", new Date("2026-05-14T09:00:00-04:00")),
    ], now);
    expect(b.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(b.today.map((t) => t.id)).toEqual(["b"]);
    expect(b.upcoming.map((t) => t.id)).toEqual(["c"]);
  });

  it("formats a due label without throwing on null", () => {
    expect(typeof formatTaskDue(null, "fr")).toBe("string");
    expect(typeof formatTaskDue(new Date().toISOString(), "en")).toBe("string");
  });
});

describe("task cache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips tasks per user and clears them", () => {
    const t = [task("a", new Date())];
    saveTaskCache("u1", t);
    expect(loadTaskCache("u1")).toHaveLength(1);
    expect(loadTaskCache("u2")).toHaveLength(0);
    clearTaskCache("u1");
    expect(loadTaskCache("u1")).toHaveLength(0);
  });

  it("returns an empty list on corrupt cache", () => {
    localStorage.setItem("pp_tasks_cache_u1", "{{{");
    expect(loadTaskCache("u1")).toEqual([]);
  });
});
