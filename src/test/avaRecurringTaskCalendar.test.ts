import { describe, expect, it, vi } from "vitest";
import { createTaskWithOutlook, outlookTaskRecurrence } from "../../supabase/functions/_shared/ava-task-calendar";
import { buildCreatePayload } from "../../supabase/functions/_shared/planipret-tasks";

const input = { notes: "Monday reminder", due_at: "2026-11-02 09:00:00", recurrence: { value: 1, pattern: "week", on: [1] }, link_outlook: true, confirmed: true };

describe("AVA recurring Maestro task linked directly to Outlook", () => {
  it("creates a weekly Monday morning series in Toronto, including the DST change", () => {
    const recurrence = outlookTaskRecurrence(input.recurrence, "2026-11-02T09:00:00");
    expect(recurrence).toEqual({ pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"], firstDayOfWeek: "sunday" }, range: { type: "noEnd", startDate: "2026-11-02", recurrenceTimeZone: "America/Toronto" } });
    const maestro = buildCreatePayload({ ...input, xid: 67, type: "user" });
    expect(maestro.ok).toBe(true);
    if (!maestro.ok) return;
    expect(maestro.payload).toMatchObject({ date: "2026-11-02 09:00:00", is_recurring: 1, recurring_value: 1, recurring_pattern: "week", recurring_on: [1], sync_cal: 0 });
  });

  it("keeps the same recurrence and links the event to the created task without a Teams invitation", async () => {
    const task = vi.fn().mockResolvedValue({ success: true, task_id: "42" });
    const event = vi.fn().mockResolvedValue({ success: true, event_id: "outlook-42" });
    const result = await createTaskWithOutlook(input, task, event);
    expect(task).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ recurrence: input.recurrence, start_datetime: input.due_at, is_online: false, transaction_id: "maestro-task-42", confirmed: true, idempotency_key: "maestro-task-42:outlook" }));
    expect(result).toMatchObject({ success: true, task_id: "42", outlook_created: true, event_id: "outlook-42" });
  });

  it("does not create Outlook events unless explicitly requested", async () => {
    const event = vi.fn();
    await createTaskWithOutlook({ ...input, link_outlook: false }, async () => ({ success: true, task_id: "42" }), event);
    expect(event).not.toHaveBeenCalled();
  });

  it("never creates Outlook when Maestro creation fails or is unconfirmed", async () => {
    const event = vi.fn();
    const result = await createTaskWithOutlook(input, async () => ({ success: false, error: "maestro_readback_unconfirmed" }), event);
    expect(result.success).toBe(false);
    expect(event).not.toHaveBeenCalled();
  });

  it.each(["rejected", "timeout"])("reports partial success and never retries on Outlook %s", async (failure) => {
    const task = vi.fn().mockResolvedValue({ success: true, task_id: "42" });
    const event = failure === "timeout" ? vi.fn().mockRejectedValue(new Error("timeout")) : vi.fn().mockResolvedValue({ success: false, error: "missing_scope" });
    const result = await createTaskWithOutlook(input, task, event);
    expect(result).toMatchObject({ success: false, task_created: true, outlook_created: false, task_id: "42", error: "outlook_link_failed" });
    expect(task).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
  });

  it("cannot create an unlinked Outlook event when Maestro omits its task id", async () => {
    const event = vi.fn();
    const result = await createTaskWithOutlook(input, async () => ({ success: true }), event);
    expect(result).toMatchObject({ success: false, task_created: true, error: "task_id_missing" });
    expect(event).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])("rejects invalid recurrence interval %s", (value) => {
    expect(() => outlookTaskRecurrence({ ...input.recurrence, value }, "2026-11-02T09:00:00")).toThrow("invalid_recurrence_interval");
  });

  it("rejects invalid weekdays instead of silently creating a different series", () => {
    expect(() => outlookTaskRecurrence({ ...input.recurrence, on: [7] }, "2026-11-02T09:00:00")).toThrow("invalid_recurrence_weekdays");
  });
});