// Planiprêt Task API gateway — the ONLY path the mobile app and AVA use to
// read/write tasks. Never expose the Planiprêt bearer token to the client.
//
// Routes consumed (official docs: https://client.planipret.com/api-docs):
//   POST   /api/main/tasks
//   PUT    /api/main/tasks/{taskId}    (task_id also in body)
//   DELETE /api/main/tasks/{taskId}    (task_id also in body, soft delete)
// Listing is NOT officially documented: we best-effort the internal
// `GET /telecom/api/v1/users/{telecomUserId}/tasks` and degrade to the local
// projection (`planipret_tasks_projection`) or `tasks_unavailable`.
//
// Body: { action: "list" | "get" | "create" | "update" | "delete", ... }
import { authBroker, corsHeaders, jsonResponse, supaAdmin } from "../_shared/ns-broker.ts";
import { getUserMaestroAccessToken } from "../_shared/maestro-oauth.ts";
import { resolveTelecomUserId } from "../_shared/maestro-broker-directory.ts";
import {
  bucketTasks,
  buildCreatePayload,
  filterTasks,
  normalizeFilter,
  paginate,
  taskCounts,
  buildUpdateBody,
  canDeleteTask,
  idempotencyKey,
  mapTaskApiError,
  normalizeTask,
} from "../_shared/planipret-tasks.ts";

const API_BASE = (Deno.env.get("PLANIPRET_API_BASE_URL") ?? "https://client.planipret.com").replace(/\/$/, "");
const TELECOM_BASE = (Deno.env.get("MAESTRO_TELECOM_BASE_URL") ?? "https://client.planipret.com/telecom/api/v1").replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

type Admin = ReturnType<typeof supaAdmin>;

function corr() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function audit(admin: Admin, row: Record<string, unknown>) {
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

async function planipretToken(admin: Admin, userId: string): Promise<string | null> {
  const oauth = await getUserMaestroAccessToken(admin, userId).catch(() => null);
  if (oauth) return oauth;
  const env = Deno.env.get("PLANIPRET_ACCESS_TOKEN") ?? "";
  return env || null;
}

async function apiFetch(token: string, path: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    const aborted = String(e).includes("Abort");
    return { status: aborted ? 408 : 599, ok: false, data: { message: aborted ? "timeout" : String(e) } };
  } finally {
    clearTimeout(timer);
  }
}

/** Replay protection: the same idempotency key always returns the first result. */
async function withIdempotency(
  admin: Admin,
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
  if (ins.error) {
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

async function projectionUpsert(admin: Admin, userId: string, tasks: any[]) {
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

async function loadProjection(admin: Admin, userId: string) {
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
async function syncProjection(admin: Admin, userId: string, tasks: any[], opts: { full: boolean }) {
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
 * Listing by maestro id. Planiprêt documents no public GET, so we walk the
 * known internal read paths in order and keep the first one that answers.
 */
async function fetchUpstreamTasks(
  token: string,
  maestroId: string,
  opts: { status?: string | null; from?: string | null; to?: string | null },
): Promise<{ ok: boolean; tasks: any[]; endpoint: string | null; status: number }> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  qs.set("limit", "200");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const candidates = [
    `${TELECOM_BASE}/users/${maestroId}/tasks${suffix}`,
    `${API_BASE}/telecom/api/v1/users/${maestroId}/tasks${suffix}`,
    `${API_BASE}/api/main/tasks${suffix}${suffix ? "&" : "?"}xid=${maestroId}&type=user`,
  ];

  let lastStatus = 0;
  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      const raw = Array.isArray(j) ? j : (j?.data ?? j?.tasks ?? j?.items ?? []);
      const tasks = (Array.isArray(raw) ? raw : []).map(normalizeTask).filter((t: any) => t.id);
      return { ok: true, tasks, endpoint: url.split("?")[0], status: res.status };
    } catch {
      lastStatus = 599;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, tasks: [], endpoint: null, status: lastStatus };
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  const auth = await authBroker(req);
  if ("error" in auth) return auth.error;
  const { admin, userId, profile } = auth as { admin: Admin; userId: string; profile: any };

  // GET is the read-only listing surface:
  //   GET ?maestro_id=387460525&filter=today&page=1&limit=20&status=pending
  let body: any = {};
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    body = Object.fromEntries(q.entries());
    body.action = body.action ?? "list";
  } else {
    body = await req.json().catch(() => ({} as any));
  }
  const action = String(body?.action ?? "list");
  const source = String(body?.source ?? "app");
  const sessionId = body?.session_id ?? null;
  const correlation_id = String(body?.correlation_id ?? corr());
  const role = profile?.role ?? "broker";

  const token = await planipretToken(admin, userId);
  if (!token && action !== "list") {
    return jsonResponse({ success: false, error: "planipret_unauthorized", message: "Compte Maestro non connecté.", correlation_id }, 200);
  }


  try {
    // ── LIST (GET-style listing by maestro id, filtered + paginated) ──────
    if (action === "list") {
      const filter = normalizeFilter(body?.filter);
      const page = Math.max(Number(body?.page ?? 1) || 1, 1);
      const limit = Math.min(Math.max(Number(body?.limit ?? 20) || 20, 1), 200);
      const status = body?.status ? String(body.status) : "pending";
      const from = body?.from ? String(body.from) : null;
      const to = body?.to ? String(body.to) : null;

      // Authoritative identity: the broker's maestro / telecom id.
      let maestroId: string | null = profile?.maestro_broker_id ? String(profile.maestro_broker_id) : null;
      let telecomId: string | null = null;
      try {
        const r = await resolveTelecomUserId(admin, userId, { candidate: maestroId });
        telecomId = r.id;
        maestroId = maestroId ?? r.id;
      } catch { /* keep null */ }

      const upstream = telecomId && token
        ? await fetchUpstreamTasks(token, telecomId, { status, from, to })
        : { ok: false as const, tasks: [] as any[], endpoint: null, status: 0 };

      let all: any[];
      let src: "api" | "projection" | "unavailable";
      if (upstream.ok) {
        all = upstream.tasks;
        src = "api";
        await syncProjection(admin, userId, all, { full: !from && !to });
      } else {
        all = await loadProjection(admin, userId);
        src = all.length ? "projection" : "unavailable";
      }

      const now = new Date();
      const counts = taskCounts(all, now);
      const filtered = filterTasks(all, filter, now);
      const pageOut = paginate(filtered, page, limit);
      const buckets = bucketTasks(pageOut.items, now);

      return jsonResponse({
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
      });
    }


    // ── GET ───────────────────────────────────────────────────────────────
    if (action === "get") {
      const taskId = String(body?.task_id ?? "").trim();
      if (!taskId) return jsonResponse({ success: false, error: "validation_failed", fields: { task_id: "task_id_required" } }, 200);
      const { data: row } = await admin
        .from("planipret_tasks_projection")
        .select("payload")
        .eq("user_id", userId).eq("task_id", taskId).is("deleted_at", null)
        .maybeSingle();
      if (!row) return jsonResponse({ success: false, error: "task_not_found", correlation_id }, 200);
      return jsonResponse({ success: true, source: "projection", task: normalizeTask(row.payload), correlation_id });
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (action === "create") {
      const built = buildCreatePayload(body ?? {});
      if (!built.ok) return jsonResponse({ ...built, correlation_id }, 200);
      const payload = built.payload;

      // Scope check: a `user` task must target the broker's own Planiprêt id.
      if (payload.type === "user") {
        const own = String(profile?.maestro_broker_id ?? "");
        const { data: full } = await admin.from("planipret_profiles")
          .select("maestro_broker_id, maestro_telecom_user_id").eq("id", profile.id).maybeSingle();
        const allowed = new Set([own, String(full?.maestro_broker_id ?? ""), String(full?.maestro_telecom_user_id ?? "")].filter(Boolean));
        if (allowed.size && !allowed.has(String(payload.xid))) {
          await audit(admin, { action: "task_create_denied", user_id: userId, source, session_id: sessionId, correlation_id, result: "out_of_scope" });
          return jsonResponse({ success: false, error: "xid_out_of_scope", message: "Cette cible n'appartient pas à ton périmètre.", correlation_id }, 200);
        }
      }

      const key = String(body?.idempotency_key ?? idempotencyKey(["create", userId, payload.xid as any, payload.type as any, payload.date as any, payload.notes as any]));
      const out = await withIdempotency(admin, userId, key, "create", async () => {
        const res = await apiFetch(token!, "/api/main/tasks", { method: "POST", body: JSON.stringify(payload) });
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
      return jsonResponse(out.body, 200);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (action === "update") {
      const taskId = String(body?.task_id ?? "").trim();
      const built = buildUpdateBody(taskId, body?.changes ?? {});
      if (!built.ok) return jsonResponse({ ...built, correlation_id }, 200);
      const key = String(body?.idempotency_key ?? idempotencyKey(["update", userId, taskId, JSON.stringify(built.payload)]));
      const out = await withIdempotency(admin, userId, key, "update", async () => {
        const res = await apiFetch(token!, `/api/main/tasks/${encodeURIComponent(taskId)}`, {
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
      return jsonResponse(out.body, 200);
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (action === "delete") {
      const taskId = String(body?.task_id ?? "").trim();
      if (!taskId) return jsonResponse({ success: false, error: "validation_failed", fields: { task_id: "task_id_required" }, correlation_id }, 200);
      if (!canDeleteTask(role)) {
        await audit(admin, { action: "task_delete_denied", user_id: userId, task_id: taskId, source, session_id: sessionId, correlation_id, result: "role_forbidden" });
        return jsonResponse({ success: false, error: "role_forbidden", message: "Ton rôle ne permet pas de supprimer une tâche.", correlation_id }, 200);
      }
      const key = String(body?.idempotency_key ?? idempotencyKey(["delete", userId, taskId]));
      const out = await withIdempotency(admin, userId, key, "delete", async () => {
        const res = await apiFetch(token!, `/api/main/tasks/${encodeURIComponent(taskId)}`, {
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
      return jsonResponse(out.body, 200);
    }

    return jsonResponse({ success: false, error: "unknown_action", action, correlation_id }, 200);
  } catch (e) {
    console.error("[planipret-task-api]", correlation_id, e);
    return jsonResponse({ success: false, error: "server_error", message: String(e), correlation_id }, 200);
  }
});
