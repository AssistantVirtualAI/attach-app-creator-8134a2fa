// Pure, runtime-agnostic helpers for the Planiprêt Task API.
// Imported by the `planipret-task-api` edge function AND by the mobile app
// (via src/lib/planipret/tasks.ts). Must stay free of Deno/Node globals.
//
// Official routes (https://client.planipret.com/api-docs/openapi.yaml):
//   POST   /api/main/tasks
//   PUT    /api/main/tasks/{taskId}   (task_id also required in body)
//   DELETE /api/main/tasks/{taskId}   (task_id also required in body)
// There is NO documented list endpoint — listing is best-effort server side.

export const TASK_TZ = "America/Toronto";

export type TaskType = "user" | "contract";

export interface NormalizedTask {
  id: string;
  notes: string;
  description: string | null;
  due_at: string | null; // ISO
  status: string | null;
  type: TaskType | null;
  xid: string | null;
  target_name: string | null;
  is_recurring: boolean;
  recurring_pattern: string | null;
  created_by_ava: boolean;
  raw?: unknown;
}

/** Date/time parts of `date` rendered in America/Toronto. */
export function torontoParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TASK_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = part.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour === "24" ? "00" : p.hour), mm: Number(p.minute), ss: Number(p.second),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Convert any ISO/Date/"YYYY-MM-DD HH:mm:ss" input to the API format in Toronto time. */
export function toApiDateTime(input: string | Date): string | null {
  if (!input) return null;
  if (typeof input === "string") {
    const local = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    // A naive local datetime (no timezone marker) is already Toronto wall-clock.
    if (local) return `${local[1]}-${local[2]}-${local[3]} ${local[4]}:${local[5]}:${local[6] ?? "00"}`;
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const p = torontoParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`;
}

/** Parse an API "YYYY-MM-DD HH:mm:ss" (Toronto wall-clock) into a real instant. */
export function fromApiDateTime(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).toISOString();
  // Resolve the Toronto offset for that wall-clock time.
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = torontoParts(new Date(ts));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    ts += guess - asUtc;
  }
  return new Date(ts).toISOString();
}

export function formatTaskDue(iso: string | null, lang: "fr" | "en" = "fr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "en" ? "en-CA" : "fr-CA", {
    timeZone: TASK_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export interface CreateInput {
  xid?: unknown;
  target?: unknown;
  type?: unknown;
  target_type?: unknown;
  date?: unknown;
  due_at?: unknown;
  notes?: unknown;
  description?: unknown;
  users_id?: unknown;
  assignee_id?: unknown;
  status?: unknown;
  option?: unknown;
  sync_cal?: unknown;
  sync_calendar?: unknown;
  send_notification?: unknown;
  notification?: unknown;
  is_recurring?: unknown;
  recurrence?: { value?: unknown; pattern?: unknown; on?: unknown } | null;
  recurring_value?: unknown;
  recurring_pattern?: unknown;
  recurring_on?: unknown;
  is_hidden?: unknown;
  update_status?: unknown;
}

export type ValidationResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string; fields: Record<string, string> };

const PATTERNS = new Set(["day", "week", "month", "year"]);

/** Validate + normalize a create payload for POST /api/main/tasks. */
export function buildCreatePayload(input: CreateInput): ValidationResult {
  const fields: Record<string, string> = {};
  const rawXid = input.xid ?? input.target;
  const xid = Number(String(rawXid ?? "").trim());
  if (!rawXid || !Number.isInteger(xid) || xid <= 0) fields.xid = "xid_required_integer";

  const type = String(input.type ?? input.target_type ?? "").trim().toLowerCase();
  if (type !== "user" && type !== "contract") fields.type = "type_must_be_user_or_contract";

  const date = toApiDateTime((input.date ?? input.due_at) as string);
  if (!date) fields.date = "date_required_YYYY-MM-DD_HH:mm:ss";

  const notes = String(input.notes ?? "").trim();
  if (!notes) fields.notes = "notes_required";

  if (Object.keys(fields).length) return { ok: false, error: "validation_failed", fields };

  const payload: Record<string, unknown> = { xid, type, date, notes };

  const description = String(input.description ?? "").trim();
  if (description) payload.description = description;

  const assignee = input.users_id ?? input.assignee_id;
  if (assignee !== undefined && assignee !== null && String(assignee).trim() !== "") {
    payload.users_id = Number(assignee);
  }
  if (input.status !== undefined && input.status !== null && String(input.status).trim() !== "") {
    payload.status = String(input.status);
  }
  if (input.option !== undefined && input.option !== null && String(input.option).trim() !== "") {
    payload.option = input.option;
  }
  // Notifications and calendar sync are OFF unless explicitly enabled by the broker.
  if (input.sync_cal === true || input.sync_calendar === true) payload.sync_cal = 1;
  if (input.send_notification === true || input.notification === true) payload.send_notification = 1;
  if (input.is_hidden === true) payload.is_hidden = 1;
  if (input.update_status === true) payload.update_status = 1;

  const rec = input.recurrence ?? null;
  const recValue = input.recurring_value ?? rec?.value;
  const recPattern = String(input.recurring_pattern ?? rec?.pattern ?? "").trim().toLowerCase();
  const wantsRecurring = input.is_recurring === true || (!!recPattern && recValue != null);
  if (wantsRecurring) {
    if (!PATTERNS.has(recPattern)) {
      return { ok: false, error: "validation_failed", fields: { recurring_pattern: "pattern_must_be_day_week_month_year" } };
    }
    payload.is_recurring = 1;
    payload.recurring_value = Number(recValue ?? 1);
    payload.recurring_pattern = recPattern;
    const on = input.recurring_on ?? rec?.on;
    if (on !== undefined && on !== null && String(on).trim() !== "") {
      const n = Number(on);
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        return { ok: false, error: "validation_failed", fields: { recurring_on: "must_be_0_to_6" } };
      }
      payload.recurring_on = n;
    }
  }
  return { ok: true, payload };
}

const UPDATABLE = new Set([
  "date", "notes", "description", "status_option_id", "update_status",
  "is_recurring", "recurring_value", "recurring_pattern", "next_send_date", "recurring_on",
]);

/** Body for PUT /api/main/tasks/{taskId} — task_id + only the changed fields. */
export function buildUpdateBody(taskId: string | number, changes: Record<string, unknown>): ValidationResult {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false, error: "validation_failed", fields: { task_id: "task_id_required" } };
  const body: Record<string, unknown> = { task_id: Number.isNaN(Number(id)) ? id : Number(id) };
  const src: Record<string, unknown> = { ...(changes ?? {}) };
  if (src.due_at && !src.date) src.date = src.due_at;
  for (const [k, v] of Object.entries(src)) {
    if (!UPDATABLE.has(k) || v === undefined || v === null) continue;
    if (k === "date" || k === "next_send_date") {
      const d = toApiDateTime(v as string);
      if (!d) return { ok: false, error: "validation_failed", fields: { [k]: "invalid_datetime" } };
      body[k] = d;
      continue;
    }
    if (k === "recurring_pattern" && !PATTERNS.has(String(v).toLowerCase())) {
      return { ok: false, error: "validation_failed", fields: { recurring_pattern: "pattern_must_be_day_week_month_year" } };
    }
    if (k === "is_recurring" || k === "update_status") { body[k] = v === true || v === 1 || v === "1" ? 1 : 0; continue; }
    body[k] = v;
  }
  if (Object.keys(body).length < 2) {
    return { ok: false, error: "validation_failed", fields: { changes: "no_updatable_field" } };
  }
  return { ok: true, payload: body };
}

/** Roles allowed to delete a task (assistant is explicitly excluded). */
export function canDeleteTask(role: unknown): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "admin" || r === "broker" || r === "advisor" || r === "conseiller" || r === "courtier";
}

/** Deterministic idempotency key — same inputs always yield the same key. */
export function idempotencyKey(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2654435761) >>> 0;
  }
  return `pt_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

export function normalizeTask(raw: any): NormalizedTask {
  const id = String(raw?.id ?? raw?.task_id ?? raw?.xid ?? "");
  const typeRaw = String(raw?.type ?? raw?.task_type ?? "").toLowerCase();
  return {
    id,
    notes: String(raw?.notes ?? raw?.title ?? raw?.subject ?? "").trim(),
    description: raw?.description ? String(raw.description) : null,
    due_at: fromApiDateTime(raw?.date ?? raw?.due_date ?? raw?.due_at ?? raw?.scheduled_at ?? null),
    status: raw?.status != null ? String(raw.status) : (raw?.status_option_id != null ? String(raw.status_option_id) : null),
    type: typeRaw === "user" || typeRaw === "contract" ? (typeRaw as TaskType) : null,
    xid: raw?.xid != null ? String(raw.xid) : null,
    target_name: raw?.client_name ?? raw?.contact_name ?? raw?.user_name ?? raw?.target_name ?? null,
    is_recurring: truthy(raw?.is_recurring),
    recurring_pattern: raw?.recurring_pattern ? String(raw.recurring_pattern) : null,
    created_by_ava: truthy(raw?.created_by_ava) || String(raw?.source ?? "").toLowerCase().includes("ava"),
    raw,
  };
}

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);
export function isTaskOpen(task: NormalizedTask): boolean {
  return !DONE.has(String(task.status ?? "").toLowerCase());
}

export interface TaskBuckets { overdue: NormalizedTask[]; today: NormalizedTask[]; upcoming: NormalizedTask[] }

/** Split tasks into overdue / today / upcoming using Toronto calendar days. */
export function bucketTasks(tasks: NormalizedTask[], now: Date = new Date()): TaskBuckets {
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [] };
  const n = torontoParts(now);
  const todayKey = `${n.y}${pad(n.m)}${pad(n.d)}`;
  for (const t of tasks) {
    if (!isTaskOpen(t)) continue;
    if (!t.due_at) { buckets.upcoming.push(t); continue; }
    const d = new Date(t.due_at);
    const p = torontoParts(d);
    const key = `${p.y}${pad(p.m)}${pad(p.d)}`;
    if (key < todayKey) buckets.overdue.push(t);
    else if (key === todayKey) (d.getTime() < now.getTime() ? buckets.overdue : buckets.today).push(t);
    else buckets.upcoming.push(t);
  }
  const bydue = (a: NormalizedTask, b: NormalizedTask) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9");
  buckets.overdue.sort(bydue); buckets.today.sort(bydue); buckets.upcoming.sort(bydue);
  return buckets;
}

/** Map an upstream HTTP status to a structured, AVA/UI readable error. */
export function mapTaskApiError(status: number, details?: unknown) {
  const base = { success: false as const, status, details };
  if (status === 401) return { ...base, error: "planipret_unauthorized", message: "Session Planiprêt expirée — reconnecte ton compte Maestro." };
  if (status === 403) return { ...base, error: "forbidden", message: "Action non autorisée pour ton rôle." };
  if (status === 422) return { ...base, error: "validation_failed", message: "Données de tâche invalides." };
  if (status === 404 || status === 405 || status === 501) return { ...base, error: "tasks_unavailable", message: "L'API de tâches Planiprêt n'expose pas cette opération." };
  if (status === 408 || status === 504) return { ...base, error: "timeout", message: "L'API Planiprêt n'a pas répondu à temps." };
  if (status >= 500) return { ...base, error: "upstream_error", message: "Erreur serveur Planiprêt — réessaie dans un instant." };
  return { ...base, error: "request_failed", message: "La requête vers Planiprêt a échoué." };
}
