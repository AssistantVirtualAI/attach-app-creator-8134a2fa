/**
 * Regression E2E — doc-aligned POST / PUT / DELETE payloads for the
 * Planiprêt Task API (https://client.planipret.com/api-docs).
 *
 * Asserts the exact wire payloads the gateway sends upstream, including every
 * `required_if` / `required_without` field documented by Planiprêt:
 *   - POST  : xid, type, date, notes (required) + option|status (required_without)
 *             + notification_users (required_if send_notification_client)
 *             + scheduled_at (required_if scheduled)
 *             + recurring_value/recurring_pattern (required_if is_recurring)
 *   - PUT   : task_id in the body AND in the path
 *   - DELETE: task_id in the body AND in the path
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildCreatePayload,
  buildUpdateBody,
} from "../../supabase/functions/_shared/planipret-tasks";
import { handleTaskRequest } from "../../supabase/functions/_shared/planipret-task-handler";

// ---------------------------------------------------------------- utilities
function makeAdmin() {
  const chain: any = {
    select: () => chain,
    insert: () => Promise.resolve({ error: null }),
    update: () => chain,
    upsert: () => Promise.resolve({ error: null }),
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [] }),
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (r: any) => Promise.resolve({ data: [] }).then(r),
  };
  return { from: () => chain };
}

function makeDeps(capture: any[], apiResponse: any = { status: 200, ok: true, data: { id: 9001 } }) {
  return {
    admin: makeAdmin(),
    userId: "user-1",
    profile: { role: "broker", maestro_broker_id: "387460525" },
    token: "test-token",
    apiFetch: async (path: string, init: { method: string; body?: string }) => {
      capture.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return apiResponse;
    },
    listFetch: async () => ({ ok: true, tasks: [], endpoint: "/tasks", status: 200 }),
    resolveTelecomUserId: async (c: string | null) => c ?? "387460525",
  } as any;
}

// -------------------------------------------------------------------- POST
describe("POST /api/main/tasks — doc-aligned payload", () => {
  it("sends the 4 required fields plus the required_without status slug", () => {
    const r = buildCreatePayload({
      xid: "387460525", type: "user", date: "2026-08-21 09:30:00", notes: "Rappel client",
    });
    expect(r.ok).toBe(true);
    expect((r as any).payload).toEqual({
      xid: 387460525, type: "user", date: "2026-08-21 09:30:00",
      notes: "Rappel client", status: "pending",
    });
  });

  it("uses `option` instead of `status` when the caller supplies one (required_without)", () => {
    const r = buildCreatePayload({ xid: 1, type: "contract", date: "2026-08-21 09:30", notes: "n", option: 4 }) as any;
    expect(r.ok).toBe(true);
    expect(r.payload.option).toBe(4);
    expect(r.payload.status).toBeUndefined();
  });

  it.each([
    ["xid", { type: "user", date: "2026-08-21 09:30", notes: "n" }, "xid"],
    ["type", { xid: 1, date: "2026-08-21 09:30", notes: "n" }, "type"],
    ["date", { xid: 1, type: "user", notes: "n" }, "date"],
    ["notes", { xid: 1, type: "user", date: "2026-08-21 09:30" }, "notes"],
  ])("rejects a payload missing the required field %s", (_l, input, field) => {
    const r = buildCreatePayload(input as any) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("validation_failed");
    expect(r.fields[field]).toBeTruthy();
  });

  it("requires notification_users when send_notification_client is on (required_if)", () => {
    const base = { xid: 1, type: "user" as const, date: "2026-08-21 09:30", notes: "n" };
    const bad = buildCreatePayload({ ...base, send_notification_client: true }) as any;
    expect(bad.ok).toBe(false);
    expect(bad.fields.notification_users).toBe("required_when_send_notification_client");

    const good = buildCreatePayload({ ...base, send_notification_client: true, notification_users: [12, 13] }) as any;
    expect(good.ok).toBe(true);
    expect(good.payload.send_notification_client).toBe(1);
    expect(good.payload.notification_users).toEqual([12, 13]);
  });

  it("requires scheduled_at when scheduled is on (required_if)", () => {
    const base = { xid: 1, type: "user" as const, date: "2026-08-21 09:30", notes: "n" };
    const bad = buildCreatePayload({ ...base, scheduled: true }) as any;
    expect(bad.ok).toBe(false);
    expect(bad.fields.scheduled_at).toBeTruthy();

    const good = buildCreatePayload({ ...base, scheduled: true, scheduled_at: "2026-08-20 08:00" }) as any;
    expect(good.payload.scheduled).toBe(1);
    expect(good.payload.scheduled_at).toBe("2026-08-20 08:00:00");
  });

  it("requires a valid recurring_pattern + value when is_recurring is on (required_if)", () => {
    const base = { xid: 1, type: "user" as const, date: "2026-08-21 09:30", notes: "n" };
    const bad = buildCreatePayload({ ...base, is_recurring: true, recurring_pattern: "fortnight" }) as any;
    expect(bad.ok).toBe(false);
    expect(bad.fields.recurring_pattern).toBe("pattern_must_be_day_week_month_year");

    const good = buildCreatePayload({
      ...base, is_recurring: true, recurring_pattern: "week", recurring_value: 2, recurring_on: [1, 3],
    }) as any;
    expect(good.payload.is_recurring).toBe(1);
    expect(good.payload.recurring_value).toBe(2);
    expect(good.payload.recurring_pattern).toBe("week");
    expect(good.payload.recurring_on).toEqual([1, 3]);
  });

  it("rejects recurring_on values outside 0..6", () => {
    const r = buildCreatePayload({
      xid: 1, type: "user", date: "2026-08-21 09:30", notes: "n",
      is_recurring: true, recurring_pattern: "week", recurring_value: 1, recurring_on: [9],
    }) as any;
    expect(r.fields.recurring_on).toBe("must_be_0_to_6");
  });

  it("posts to /api/main/tasks with the normalized body through the gateway", async () => {
    const calls: any[] = [];
    const res = await handleTaskRequest(
      { action: "create", xid: "387460525", type: "user", date: "2026-08-21 09:30", notes: "E2E" },
      makeDeps(calls),
    );
    expect(res.status).toBe(200);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/main/tasks");
    expect(calls[0].body).toMatchObject({ xid: 387460525, type: "user", notes: "E2E", status: "pending" });
  });
});

// --------------------------------------------------------------------- PUT
describe("PUT /api/main/tasks/{taskId} — doc-aligned payload", () => {
  it("always repeats task_id inside the body", () => {
    const r = buildUpdateBody(9001, { notes: "maj", date: "2026-08-22 14:00" }) as any;
    expect(r.payload).toEqual({ task_id: 9001, notes: "maj", date: "2026-08-22 14:00:00" });
  });

  it("drops non-updatable fields and refuses an empty change set", () => {
    const r = buildUpdateBody(9001, { xid: 5, type: "user" }) as any;
    expect(r.ok).toBe(false);
    expect(r.fields.changes).toBe("no_updatable_field");
  });

  it("normalizes recurrence flags and rejects an invalid pattern", () => {
    expect((buildUpdateBody(1, { is_recurring: true, recurring_pattern: "month", recurring_value: 3 }) as any).payload)
      .toEqual({ task_id: 1, is_recurring: 1, recurring_pattern: "month", recurring_value: 3 });
    expect((buildUpdateBody(1, { recurring_pattern: "decade" }) as any).fields.recurring_pattern).toBeTruthy();
  });

  it("puts to /api/main/tasks/{id} with task_id in path AND body", async () => {
    const calls: any[] = [];
    const res = await handleTaskRequest(
      { action: "update", task_id: "9001", changes: { notes: "maj E2E" } },
      makeDeps(calls),
    );
    expect(res.status).toBe(200);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/main/tasks/9001");
    expect(calls[0].body).toEqual({ task_id: 9001, notes: "maj E2E" });
  });
});

// ------------------------------------------------------------------ DELETE
describe("DELETE /api/main/tasks/{taskId} — doc-aligned payload", () => {
  it("deletes with task_id in path AND body", async () => {
    const calls: any[] = [];
    const res = await handleTaskRequest({ action: "delete", task_id: "9001" }, makeDeps(calls));
    expect(res.status).toBe(200);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].path).toBe("/api/main/tasks/9001");
    expect(calls[0].body).toEqual({ task_id: 9001 });
  });

  it("blocks the assistant role before any upstream call (role_forbidden)", async () => {
    const calls: any[] = [];
    const deps = makeDeps(calls);
    deps.profile = { role: "assistant", maestro_broker_id: "387460525" };
    const res = await handleTaskRequest({ action: "delete", task_id: "9001" }, deps);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

// ------------------------------------------------------- upstream contract
describe("upstream error mapping stays doc-aligned", () => {
  it("surfaces a 422 field error from Planiprêt without retrying", async () => {
    const calls: any[] = [];
    const deps = makeDeps(calls, {
      status: 422, ok: false,
      data: { message: "The given data was invalid.", errors: { notes: ["The notes field is required."] } },
    });
    const spy = vi.spyOn(deps, "apiFetch");
    const res = await handleTaskRequest(
      { action: "create", xid: "387460525", type: "user", date: "2026-08-21 09:30", notes: "x" },
      deps,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
