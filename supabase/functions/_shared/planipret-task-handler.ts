// Runtime-agnostic core of the Planiprêt Task API gateway.
// All I/O is injected (`TaskDeps`) so the exact same logic runs in the edge
// function AND under Vitest. No Deno / Node globals allowed in this file.
//
// Routes consumed (official docs: https://client.planipret.com/api-docs):
//   POST   /api/main/tasks
//   PUT    /api/main/tasks/{taskId}    (task_id also in body)
//   DELETE /api/main/tasks/{taskId}    (task_id also in body, soft delete)
// Listing is NOT officially documented — see `listFetch` in TaskDeps.
import {
  bucketTasks,
  buildCreatePayload,
  buildUpdateBody,
  canDeleteTask,
  filterTasks,
  idempotencyKey,
  mapTaskApiError,
  normalizeFilter,
  normalizeTask,
  paginate,
  taskCounts,
} from "./planipret-tasks.ts";

export interface ApiResponse { status: number; ok: boolean; data: any }

export interface UpstreamList {
  ok: boolean;
  tasks: any[];
  endpoint: string | null;
  status: number;
}

export interface TaskDeps {
  admin: any;
  userId: string;
  profile: any;
  token: string | null;
  /** Authenticated call to the official Planiprêt API (`/api/main/...`). */
  apiFetch: (path: string, init: { method: string; body?: string }) => Promise<ApiResponse>;
  /** Best-effort listing (undocumented upstream). */
  listFetch: (
    telecomId: string,
    opts: { status?: string | null; from?: string | null; to?: string | null },
  ) => Promise<UpstreamList>;
  resolveTelecomUserId: (candidate: string | null) => Promise<string | null>;
  now?: () => Date;
}

export function newCorrelationId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function audit(admin: any, row: Record<string, unknown>) {
  try {
    await admin.from("planipret_audit_log").insert({
      action: String(row.action ?? "task"),
      resource_type: "planipret_task",
      resource_id: row.task_id ? String(row.task_id) : null,
      user_id: (row.user_id as string) ?? null,
      // Never log full task notes — only structural metadata.
      metadata: {
        tool: row.tool ?? null,
        source: row.source ?? "app",
        session_id: row.session_id ?? null,
        status: row.status ?? null,
        result: row.result ?? null,
        correlation_id: row.correlation_id ?? null,
      },
    });
  } catch (_) { /* audit must never break the request */ }
}

/** Replay protection: the same idempotency key always returns the first result. */
export async function withIdempotency(
  admin: any,
  userId: string,
  key: string,
  action: string,
  run: () => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: existing } = await admin
    .from("planipret_task_mutations")
    .select("response, http_status")
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing?.response) {
    return { status: existing.http_status ?? 200, body: { ...(existing.response as any), replayed: true } };
  }
  const ins = await admin.from("planipret_task_mutations")
    .insert({ user_id: userId, idempotency_key: key, action, http_status: null, response: null });
  if (ins?.error) {
    // Concurrent double-tap: the winner is already running/finished.
    const { data: row } = await admin
      .from("planipret_task_mutations")
      .select("response, http_status")
      .eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
    if (row?.response) return { status: row.http_status ?? 200, body: { ...(row.response as any), replayed: true } };
    return { status: 200, body: { success: true, in_flight: true, replayed: true } };
  }
  const out = await run();
  await admin.from("planipret_task_mutations")
    .update({ response: out.body, http_status: out.status, completed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("idempotency_key", key);
  return out;
}

async function projectionUpsert(admin: any, userId: string, tasks: any[]) {
  if (!tasks.length) return;
  const rows = tasks.map((t) => ({
    user_id: userId,
    task_id: String(t.id),
    due_at: t.due_at,
    status: t.status,
    payload: t,
    updated_at: new Date().toISOString(),
  }));
  await admin.from("planipret_tasks_projection").upsert(rows, { onConflict: "user_id,task_id" });
}

async function loadProjection(admin: any, userId: string) {
  const { data } = await admin
    .from("planipret_tasks_projection")
    .select("payload")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true })
    .limit(200);
  return (data ?? []).map((r: any) => normalizeTask(r.payload));
}

/**
 * Full mirror of the upstream list into the projection. On an unfiltered sync
 * we also soft-delete rows the API no longer returns, so the projection stays
 * a faithful (offline-only) copy of the single source of truth.
 */
async function syncProjection(admin: any, userId: string, tasks: any[], opts: { full: boolean }) {
  await projectionUpsert(admin, userId, tasks);
  if (!opts.full) return;
  const keep = tasks.map((t) => String(t.id)).filter(Boolean);
  let q = admin.from("planipret_tasks_projection")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (keep.length) q = q.not("task_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  await q;
}

/**
 * A `contract` task may only target a contract that is officially mapped to
 * this broker (pipeline entry, synced Maestro contact, or an existing task).
 */
async function contractIsMapped(admin: any, userId: string, xid: string): Promise<boolean> {
  if (!xid) return false;
  try {
    const { data: pipe } = await admin.from("planipret_pipeline")
      .select("id").eq("user_id", userId).eq("maestro_contact_id", xid).limit(1);
    if (pipe?.length) return true;
  } catch { /* ignore */ }
  try {
    const { data: contact } = await admin.from("planipret_contacts")
      .select("id").eq("user_id", userId).eq("external_id", xid).limit(1);
    if (contact?.length) return true;
  } catch { /* ignore */ }
  try {
    const { data: known } = await admin.from("planipret_tasks_projection")
      .select("payload").eq("user_id", userId).is("deleted_at", null).limit(200);
    return (known ?? []).some((r: any) => String(r?.payload?.xid ?? "") === xid);
  } catch { /* ignore */ }
  return false;
}

export async function handleTaskRequest(

  body: any,
  deps: TaskDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { admin, userId, profile, token } = deps;
  const nowFn = deps.now ?? (() => new Date());
  const action = String(body?.action ?? "list");
  const source = String(body?.source ?? "app");
  const sessionId = body?.session_id ?? null;
  const correlation_id = String(body?.correlation_id ?? newCorrelationId());
  const role = profile?.role ?? "broker";

  if (!token && action !== "list") {
    return {
      status: 200,
      body: { success: false, error: "planipret_unauthorized", message: "Compte Maestro non connecté.", correlation_id },
    };
  }

  // ── LIST (listing by maestro id, filtered + paginated) ────────────────────
  if (action === "list") {
    const filter = normalizeFilter(body?.filter);
    const page = Math.max(Number(body?.page ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(body?.limit ?? 20) || 20, 1), 200);
    const status = body?.status ? String(body.status) : "pending";
    const from = body?.from ? String(body.from) : null;
    const to = body?.to ? String(body.to) : null;

    let maestroId: string | null = profile?.maestro_broker_id ? String(profile.maestro_broker_id) : null;
    let telecomId: string | null = null;
    try {
      telecomId = await deps.resolveTelecomUserId(maestroId);
      maestroId = maestroId ?? telecomId;
    } catch { /* keep null */ }

    const upstream = telecomId && token
      ? await deps.listFetch(telecomId, { status, from, to })
      : { ok: false as const, tasks: [] as any[], endpoint: null, status: 0 };

    let all: any[];
    let src: "api" | "projection" | "unavailable";
    if (upstream.ok) {
      all = (upstream.tasks ?? []).map((t: any) => normalizeTask(t));
      src = "api";
      await syncProjection(admin, userId, all, { full: !from && !to });
    } else {
      all = await loadProjection(admin, userId);
      src = all.length ? "projection" : "unavailable";
    }

    const now = nowFn();
    const counts = taskCounts(all, now);
    const filtered = filterTasks(all, filter, now);
    const pageOut = paginate(filtered, page, limit);
    const buckets = bucketTasks(pageOut.items, now);

    return {
      status: 200,
      body: {
        success: true,
        source: src,
        maestro_user_id: maestroId,
        telecom_user_id: telecomId,
        endpoint: upstream.endpoint,
        filter,
        tasks: pageOut.items,
        buckets,
        counts,
        overdue_count: counts.overdue,
        page: pageOut.page,
        limit: pageOut.limit,
        total: pageOut.total,
        has_more: pageOut.has_more,
        ...(src === "unavailable"
          ? { error: "tasks_unavailable", message: "Liste des tâches indisponible pour le moment." }
          : src === "projection"
            ? { message: "Dernier état connu (liste live indisponible)." }
            : {}),
        correlation_id,
      },
    };
  }

  // ── GET (live first, projection fallback) ─────────────────────────────────
  if (action === "get") {
    const taskId = String(body?.task_id ?? "").trim();
    if (!taskId) {
      return { status: 200, body: { success: false, error: "validation_failed", fields: { task_id: "task_id_required" }, correlation_id } };
    }

    // 1) Authoritative source: same connector as `list`.
    try {
      let maestroId: string | null = profile?.maestro_broker_id ? String(profile.maestro_broker_id) : null;
      const telecomId = await deps.resolveTelecomUserId(maestroId);
      if (telecomId && token) {
        const upstream = await deps.listFetch(telecomId, { status: null, from: null, to: null });
        if (upstream.ok) {
          const all = (upstream.tasks ?? []).map((t: any) => normalizeTask(t));
          await projectionUpsert(admin, userId, all);
          const hit = all.find((t: any) => String(t.id) === taskId);
          if (hit) return { status: 200, body: { success: true, source: "api", task: hit, correlation_id } };
        }
      }
    } catch { /* fall through to projection */ }

    // 2) Offline fallback.
    const { data: row } = await admin
      .from("planipret_tasks_projection")
      .select("payload")
      .eq("user_id", userId).eq("task_id", taskId).is("deleted_at", null)
      .maybeSingle();
    if (!row) return { status: 200, body: { success: false, error: "task_not_found", correlation_id } };
    return { status: 200, body: { success: true, source: "projection", task: normalizeTask(row.payload), correlation_id } };
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────
  if (action === "create") {
    const built = buildCreatePayload(body ?? {});
    if (!built.ok) return { status: 200, body: { success: false, ...built, correlation_id } };
    const payload = built.payload;

    // Scope check: a `user` task must target the broker's own Planiprêt id.
    if (payload.type === "user") {
      const own = String(profile?.maestro_broker_id ?? "");
      const { data: full } = await admin.from("planipret_profiles")
        .select("maestro_broker_id, maestro_telecom_user_id").eq("id", profile?.id).maybeSingle();
      const allowed = new Set([own, String(full?.maestro_broker_id ?? ""), String(full?.maestro_telecom_user_id ?? "")].filter(Boolean));
      if (allowed.size && !allowed.has(String(payload.xid))) {
        await audit(admin, { action: "task_create_denied", user_id: userId, source, session_id: sessionId, correlation_id, result: "out_of_scope" });
        return { status: 200, body: { success: false, error: "xid_out_of_scope", message: "Cette cible n'appartient pas à ton périmètre.", correlation_id } };
      }
    }

    // Scope check: a `contract` task must target a contract mapped to this user.
    if (payload.type === "contract") {
      const xid = String(payload.xid ?? "");
      const mapped = await contractIsMapped(admin, userId, xid);
      if (!mapped) {
        await audit(admin, { action: "task_create_denied", user_id: userId, source, session_id: sessionId, correlation_id, result: "target_mapping_required" });
        return {
          status: 200,
          body: {
            success: false,
            error: "target_mapping_required",
            message: "Ce contrat n'est pas rattaché à ton compte Planiprêt.",
            correlation_id,
          },
        };
      }
    }


    const key = String(body?.idempotency_key ?? idempotencyKey(["create", userId, payload.xid as any, payload.type as any, payload.date as any, payload.notes as any]));
    const out = await withIdempotency(admin, userId, key, "create", async () => {
      const res = await deps.apiFetch("/api/main/tasks", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        await audit(admin, { action: "task_create_failed", user_id: userId, source, session_id: sessionId, status: res.status, correlation_id, result: "error" });
        return { status: 200, body: { ...mapTaskApiError(res.status, res.data), correlation_id } };
      }
      const raw = res.data?.data ?? res.data?.task ?? res.data ?? {};
      const task = normalizeTask({ ...payload, ...raw, created_by_ava: source !== "app" });
      if (task.id) await projectionUpsert(admin, userId, [task]);
      await audit(admin, { action: "task_created", user_id: userId, task_id: task.id, source, session_id: sessionId, status: res.status, correlation_id, result: "ok" });
      return { status: 200, body: { success: true, task, task_id: task.id, correlation_id } };
    });
    return { status: 200, body: out.body };
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  if (action === "update") {
    const taskId = String(body?.task_id ?? "").trim();
    const built = buildUpdateBody(taskId, body?.changes ?? {});
    if (!built.ok) return { status: 200, body: { success: false, ...built, correlation_id } };
    const key = String(body?.idempotency_key ?? idempotencyKey(["update", userId, taskId, JSON.stringify(built.payload)]));
    const out = await withIdempotency(admin, userId, key, "update", async () => {
      const res = await deps.apiFetch(`/api/main/tasks/${encodeURIComponent(taskId)}`, {
        method: "PUT", body: JSON.stringify(built.payload),
      });
      if (!res.ok) {
        await audit(admin, { action: "task_update_failed", user_id: userId, task_id: taskId, source, session_id: sessionId, status: res.status, correlation_id, result: "error" });
        return { status: 200, body: { ...mapTaskApiError(res.status, res.data), correlation_id } };
      }
      const { data: row } = await admin.from("planipret_tasks_projection")
        .select("payload").eq("user_id", userId).eq("task_id", taskId).maybeSingle();
      const merged = normalizeTask({ ...(row?.payload ?? { id: taskId }), ...(res.data?.data ?? res.data ?? {}), ...built.payload, id: taskId });
      await projectionUpsert(admin, userId, [merged]);
      await audit(admin, { action: "task_updated", user_id: userId, task_id: taskId, source, session_id: sessionId, status: res.status, correlation_id, result: "ok" });
      return { status: 200, body: { success: true, task: merged, task_id: taskId, correlation_id } };
    });
    return { status: 200, body: out.body };
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const taskId = String(body?.task_id ?? "").trim();
    if (!taskId) {
      return { status: 200, body: { success: false, error: "validation_failed", fields: { task_id: "task_id_required" }, correlation_id } };
    }
    if (!canDeleteTask(role)) {
      await audit(admin, { action: "task_delete_denied", user_id: userId, task_id: taskId, source, session_id: sessionId, correlation_id, result: "role_forbidden" });
      return { status: 200, body: { success: false, error: "role_forbidden", message: "Ton rôle ne permet pas de supprimer une tâche.", correlation_id } };
    }
    const key = String(body?.idempotency_key ?? idempotencyKey(["delete", userId, taskId]));
    const out = await withIdempotency(admin, userId, key, "delete", async () => {
      const res = await deps.apiFetch(`/api/main/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE", body: JSON.stringify({ task_id: Number.isNaN(Number(taskId)) ? taskId : Number(taskId) }),
      });
      if (!res.ok) {
        await audit(admin, { action: "task_delete_failed", user_id: userId, task_id: taskId, source, session_id: sessionId, status: res.status, correlation_id, result: "error" });
        return { status: 200, body: { ...mapTaskApiError(res.status, res.data), correlation_id } };
      }
      await admin.from("planipret_tasks_projection")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", userId).eq("task_id", taskId);
      await audit(admin, { action: "task_deleted", user_id: userId, task_id: taskId, source, session_id: sessionId, status: res.status, correlation_id, result: "ok" });
      return { status: 200, body: { success: true, task_id: taskId, deleted: true, correlation_id } };
    });
    return { status: 200, body: out.body };
  }

  return { status: 200, body: { success: false, error: "unknown_action", action, correlation_id } };
}
