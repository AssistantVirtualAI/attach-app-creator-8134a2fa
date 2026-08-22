import { describe, it, expect, vi } from "vitest";
import { handleTaskRequest, normalizeClientTarget, targetAllowed } from "../../supabase/functions/_shared/planipret-task-handler";
import { computeTaskSync, normalizeTask } from "../../supabase/functions/_shared/planipret-tasks";
import { createMockAdmin } from "./mockSupabaseAdmin";

const CLIENT_ROW = {
  id: 387428079,
  first_name: "Test",
  last_name: "Address",
  email: "test1@address.com",
  task_targets: {
    user: { id: 387428079, eligible_broker_ids: [247398] },
    contracts: [{ id: 311059, number: null }],
  },
};

function makeDeps(over: Record<string, any> = {}) {
  const calls: any[] = [];
  const apiFetch = vi.fn(async (path: string, init: any) => {
    calls.push({ path, init });
    return { ok: true, status: 200, data: { data: { id: 946400, users: [{ id: 93135 }] } } };
  });
  const admin = over.admin ?? createMockAdmin({
    planipret_profiles: [{ id: "profile-1", maestro_broker_id: "247398", maestro_telecom_user_id: "93135" }],
  });
  const deps: any = {
    admin,
    userId: "user-1",
    role: "broker",
    profile: { id: "profile-1", maestro_broker_id: "247398", maestro_telecom_user_id: "93135" },
    apiFetch,
    tokenValid: true,
    resolveTelecomUserId: async () => "93135",
    resolveTaskAssigneeId: async () => "93135",
    listAllowedAssignees: async () => ["93135", "247398"],
    clientTargetsFetch: async () => [CLIENT_ROW],
    ...over,
  };
  return { deps, calls, apiFetch, admin };
}

const base = {
  action: "create",
  notes: "Rappeler le client",
  date: "2026-09-01 10:00:00",
  source: "app",
};

describe("task_targets — normalisation", () => {
  it("reads user and contract targets from the Client List API", () => {
    const t = normalizeClientTarget(CLIENT_ROW)!;
    expect(t.user).toEqual({ id: "387428079", eligible_broker_ids: ["247398"] });
    expect(t.contracts).toEqual([{ id: "311059", number: null }]);
    expect(t.name).toBe("Test Address");
  });

  it("ignores rows without any task target", () => {
    expect(normalizeClientTarget({ id: 1, task_targets: { contracts: [] } })).toBeNull();
  });

  it("matches only eligible brokers", () => {
    const t = [normalizeClientTarget(CLIENT_ROW)!];
    expect(targetAllowed(t, "user", "387428079", ["247398"])).toBe(true);
    expect(targetAllowed(t, "user", "387428079", ["999"])).toBe(false);
    expect(targetAllowed(t, "contract", "311059", ["247398"])).toBe(true);
    expect(targetAllowed(t, "contract", "999", ["247398"])).toBe(false);
  });
});

describe("task creation with task_targets", () => {
  it("creates a client task for type=user with the task_targets user id", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleTaskRequest({ ...base, type: "user", xid: 387428079 }, deps);
    expect(out.body.success).toBe(true);
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toMatchObject({ type: "user", xid: 387428079 });
  });

  it("creates a contract task with a task_targets contract id", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleTaskRequest({ ...base, type: "contract", xid: 311059 }, deps);
    expect(out.body.success).toBe(true);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ type: "contract", xid: 311059 });
  });

  it("still allows a personal task on the broker's own id", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ ...base, type: "user" }, deps);
    expect(out.body.success).toBe(true);
  });

  it("rejects a user xid absent from task_targets", async () => {
    const { deps, apiFetch } = makeDeps();
    const out = await handleTaskRequest({ ...base, type: "user", xid: 999999 }, deps);
    expect(out.body).toMatchObject({ success: false, error: "xid_out_of_scope" });
    expect(out.body.validation.available.users).toEqual(["387428079"]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a user xid whose eligible_broker_ids exclude the broker", async () => {
    const { deps, apiFetch } = makeDeps({
      clientTargetsFetch: async () => [{ ...CLIENT_ROW, task_targets: { ...CLIENT_ROW.task_targets, user: { id: 387428079, eligible_broker_ids: [111] } } }],
    });
    const out = await handleTaskRequest({ ...base, type: "user", xid: 387428079 }, deps);
    expect(out.body.error).toBe("xid_out_of_scope");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a contract xid absent from task_targets", async () => {
    const { deps, apiFetch } = makeDeps();
    const out = await handleTaskRequest({ ...base, type: "contract", xid: 424242 }, deps);
    expect(out.body).toMatchObject({ success: false, error: "target_mapping_required" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the Client List API is unavailable", async () => {
    const { deps, apiFetch } = makeDeps({ clientTargetsFetch: undefined });
    const out = await handleTaskRequest({ ...base, type: "user", xid: 387428079 }, deps);
    expect(out.body.error).toBe("xid_out_of_scope");
    expect(out.body.validation.reason).toBe("clients_api_unavailable");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the Client List API throws", async () => {
    const { deps, apiFetch } = makeDeps({ clientTargetsFetch: async () => { throw new Error("boom"); } });
    const out = await handleTaskRequest({ ...base, type: "contract", xid: 311059 }, deps);
    expect(out.body.error).toBe("target_mapping_required");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("audits every denied creation", async () => {
    const { deps, admin } = makeDeps();
    await handleTaskRequest({ ...base, type: "user", xid: 999999 }, deps);
    expect(admin.db.planipret_audit_log?.[0].action).toBe("task_create_denied");
  });
});

describe("client_targets & validate_target endpoints", () => {
  it("exposes the resolved targets", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ action: "client_targets", search: "test" }, deps);
    expect(out.body).toMatchObject({ success: true, count: 1, source: "clients_api" });
    expect(out.body.targets[0].contracts[0].id).toBe("311059");
  });

  it("validates a good user target without calling the API", async () => {
    const { deps, apiFetch } = makeDeps();
    const out = await handleTaskRequest({ action: "validate_target", type: "user", xid: "387428079" }, deps);
    expect(out.body.valid).toBe(true);
    expect(out.body.validation.matched.name).toBe("Test Address");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("returns xid_out_of_scope with the available targets", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ action: "validate_target", type: "user", xid: "1" }, deps);
    expect(out.body.valid).toBe(false);
    expect(out.body.validation).toMatchObject({ error: "xid_out_of_scope", targets_source: "clients_api" });
    expect(out.body.validation.available.contracts).toEqual(["311059"]);
  });

  it("returns target_mapping_required for an unknown contract", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ action: "validate_target", type: "contract", xid: "1" }, deps);
    expect(out.body.validation.error).toBe("target_mapping_required");
  });

  it("rejects an unsupported target type", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ action: "validate_target", type: "lead", xid: "1" }, deps);
    expect(out.body).toMatchObject({ success: false, error: "validation_failed" });
  });

  it("requires an xid", async () => {
    const { deps } = makeDeps();
    const out = await handleTaskRequest({ action: "validate_target", type: "user", xid: "" }, deps);
    expect(out.body.validation.reason).toBe("xid_required");
  });
});

describe("task sync status (Nylas)", () => {
  it("marks a task synced when a Nylas event is linked", () => {
    expect(computeTaskSync({ id: 1, nylas_event_id: "evt_1" }, ["93135"]).sync_status).toBe("synced");
  });

  it("marks a task pending when calendar sync was requested but no event exists", () => {
    expect(computeTaskSync({ id: 1, sync_calendar: true }, ["93135"]))
      .toEqual({ sync_status: "pending", sync_reason: "awaiting_nylas" });
  });

  it("explains a missing assignment", () => {
    expect(computeTaskSync({ id: 1, sync_calendar: true }, []).sync_reason).toBe("assignment_missing");
  });

  it("explains a disabled calendar sync", () => {
    expect(computeTaskSync({ id: 1 }, ["93135"]).sync_reason).toBe("calendar_sync_disabled");
  });

  it("reports upstream sync failures", () => {
    expect(computeTaskSync({ id: 1, sync_status: "failed" }).sync_status).toBe("not_synced");
  });

  it("exposes the fields on normalized tasks", () => {
    const t = normalizeTask({ id: 5, notes: "x", users: [{ id: 93135 }], nylas_id: "evt" });
    expect(t.sync_status).toBe("synced");
    expect(t.sync_reason).toBe("nylas_event_linked");
  });
});
