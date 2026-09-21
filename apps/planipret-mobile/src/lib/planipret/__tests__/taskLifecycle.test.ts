import { describe, it, expect } from "vitest";
import { taskLifecycleStage, taskOrigin, isMobileCreatedTask, taskCreatedAt } from "@/lib/planipret/taskLifecycle";

const t = (o: any) => ({ id: "1", notes: "", description: null, due_at: null, status: null, type: null, xid: null, target_name: null, is_recurring: false, recurring_pattern: null, created_by_ava: false, assignee_ids: [], assignment_source: "none", sync_status: "unknown", sync_reason: "unknown", raw: {}, ...o }) as any;

describe("task lifecycle", () => {
  it("créée sans assignation confirmée", () => expect(taskLifecycleStage(t({}))).toBe("created"));
  it("confirmée avec assignation relue", () => expect(taskLifecycleStage(t({ assignee_ids: ["7"] }))).toBe("confirmed"));
  it("clôturée quand terminée", () => expect(taskLifecycleStage(t({ status: "completed", assignee_ids: ["7"] }))).toBe("closed"));
  it("origine mobile", () => {
    const task = t({ raw: { source: "mobile_manual", created_at: "2026-09-20T12:00:00Z" } });
    expect(taskOrigin(task)).toBe("mobile");
    expect(isMobileCreatedTask(task)).toBe(true);
    expect(taskCreatedAt(task)).toBe("2026-09-20T12:00:00Z");
  });
  it("origine maestro par défaut", () => expect(isMobileCreatedTask(t({}))).toBe(false));
});
