// Lemtel-only mobile configuration administrator — source package only.
// Deployment, Auth account creation, and client cutover each require separate approval.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const CHANNELS = ["staging", "production"] as const;
const ACTIONS = ["create_draft", "update_draft", "list_drafts", "publish", "retire"] as const;
const SENSITIVE_KEY_RE = /(?:pass(?:word)?|secret|token|credential|authorization|api[_-]?key|private|sip|turn|wss|endpoint|host|url)/i;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 5;
const MAX_JSON_KEYS = 50;
const MAX_MESSAGE_LENGTH = 512;

export type Channel = typeof CHANNELS[number];
export type Action = typeof ACTIONS[number];
type Failure = { error: string; status: number };
type JsonRecord = Record<string, string | number | boolean | null | JsonRecord>;

type DraftFields = {
  flags: JsonRecord;
  messages: JsonRecord;
  settings: JsonRecord;
  minVersion: string | null;
  recommendedVersion: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
};

export type RequestBody =
  | ({ action: "create_draft"; organizationId: string; channel: Channel; revision: number } & DraftFields)
  | ({ action: "update_draft"; organizationId: string; channel: Channel; configId: string } & DraftFields)
  | { action: "list_drafts"; organizationId: string; channel: Channel }
  | { action: "publish" | "retire"; organizationId: string; channel: Channel; configId: string };

const failure = (error: string, status: number): Failure => ({ error, status });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateSafeJson(value: unknown, depth = 0): value is JsonRecord {
  if (!isPlainObject(value) || depth > MAX_JSON_DEPTH || Object.keys(value).length > MAX_JSON_KEYS) return false;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_JSON_BYTES) return false; } catch { return false; }
  for (const [key, nested] of Object.entries(value)) {
    if (!key || key.length > 80 || SENSITIVE_KEY_RE.test(key)) return false;
    if (typeof nested === "string" && nested.length > MAX_MESSAGE_LENGTH) return false;
    if (nested !== null && !["string", "number", "boolean"].includes(typeof nested)) {
      if (!validateSafeJson(nested, depth + 1)) return false;
    }
  }
  return true;
}

function validVersion(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && VERSION_RE.test(value));
}

function validDraftFields(value: Record<string, unknown>): value is Record<keyof DraftFields, unknown> {
  return validateSafeJson(value.flags) && validateSafeJson(value.messages) && validateSafeJson(value.settings)
    && validVersion(value.minVersion) && validVersion(value.recommendedVersion)
    && typeof value.maintenanceMode === "boolean"
    && (value.maintenanceMessage === null || (typeof value.maintenanceMessage === "string" && value.maintenanceMessage.length <= MAX_MESSAGE_LENGTH));
}

const fieldsFor = (action: Action): readonly string[] => {
  const common = ["action", "organizationId", "channel"];
  if (action === "list_drafts") return common;
  if (action === "publish" || action === "retire") return [...common, "configId"];
  const draft = ["flags", "messages", "settings", "minVersion", "recommendedVersion", "maintenanceMode", "maintenanceMessage"];
  return action === "create_draft" ? [...common, "revision", ...draft] : [...common, "configId", ...draft];
};

// Validation runs before any authentication or database access and never echoes request values.
export function validateBody(raw: unknown): RequestBody | Failure {
  if (!isPlainObject(raw) || typeof raw.action !== "string" || !(ACTIONS as readonly string[]).includes(raw.action)) return failure("invalid_body", 400);
  const action = raw.action as Action;
  const expected = fieldsFor(action);
  if (Object.keys(raw).some((key) => !expected.includes(key)) || expected.some((key) => !(key in raw))) return failure("invalid_body", 400);
  if (typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return failure("invalid_organization_id", 400);
  if (typeof raw.channel !== "string" || !(CHANNELS as readonly string[]).includes(raw.channel)) return failure("invalid_channel", 400);
  const base = { action, organizationId: raw.organizationId.toLowerCase(), channel: raw.channel as Channel };
  if (action === "list_drafts") return base;
  if (action === "publish" || action === "retire") {
    if (typeof raw.configId !== "string" || !UUID_RE.test(raw.configId)) return failure("invalid_config_id", 400);
    return { ...base, action, configId: raw.configId.toLowerCase() };
  }
  if (!validDraftFields(raw)) return failure("invalid_draft", 400);
  const draft: DraftFields = {
    flags: raw.flags as JsonRecord,
    messages: raw.messages as JsonRecord,
    settings: raw.settings as JsonRecord,
    minVersion: raw.minVersion as string | null,
    recommendedVersion: raw.recommendedVersion as string | null,
    maintenanceMode: raw.maintenanceMode as boolean,
    maintenanceMessage: raw.maintenanceMessage as string | null,
  };
  if (action === "create_draft") {
    if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) return failure("invalid_revision", 400);
    return { ...base, action, revision: raw.revision as number, ...draft };
  }
  if (typeof raw.configId !== "string" || !UUID_RE.test(raw.configId)) return failure("invalid_config_id", 400);
  return { ...base, action, configId: raw.configId.toLowerCase(), ...draft };
}

function requireEnvironment(): { url: string; serviceRoleKey: string } | Failure {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return failure("server_not_configured", 503);
  return { url, serviceRoleKey };
}

function toDraftResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    channel: row.channel,
    revision: row.revision,
    status: row.status,
    flags: row.flags,
    messages: row.messages,
    settings: row.settings,
    minVersion: row.min_version,
    recommendedVersion: row.recommended_version,
    maintenanceMode: row.maintenance_mode,
    maintenanceMessage: row.maintenance_message,
    createdAt: row.created_at,
  };
}

function rpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return data.length === 1 && typeof data[0] === "object" && data[0] !== null ? data[0] as Record<string, unknown> : null;
  return typeof data === "object" && data !== null ? data as Record<string, unknown> : null;
}

function toTransitionResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    channel: row.channel,
    revision: row.revision,
    status: row.status,
    publishedAt: row.published_at,
    retiredAt: row.retired_at,
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  let raw: unknown;
  try { raw = await req.json(); } catch { return response({ error: "invalid_json" }, 400); }
  const request = validateBody(raw);
  if (isFailure(request)) return response({ error: request.error }, request.status);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return response({ error: "unauthorized" }, 401);

  const environment = requireEnvironment();
  if (isFailure(environment)) return response({ error: environment.error }, environment.status);
  const admin = createClient(environment.url, environment.serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return response({ error: "unauthorized" }, 401);

  const { data: membership, error: membershipError } = await admin
    .from("lemtel_organization_memberships")
    .select("role,status")
    .eq("organization_id", request.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) return response({ error: "forbidden" }, 403);

  const SELECT_COLUMNS = "id,channel,revision,status,flags,messages,settings,min_version,recommended_version,maintenance_mode,maintenance_message,created_at";
  if (request.action === "list_drafts") {
    const { data, error } = await admin
      .from("lemtel_mobile_config_revisions")
      .select(SELECT_COLUMNS)
      .eq("organization_id", request.organizationId)
      .eq("channel", request.channel)
      .eq("status", "draft")
      .order("revision", { ascending: false })
      .limit(50);
    if (error) return response({ error: "configuration_read_failed" }, 500);
    return response({ drafts: (data ?? []).map((row) => toDraftResponse(row as Record<string, unknown>)) });
  }

  if (request.action === "create_draft" || request.action === "update_draft") {
    const rpcArguments = {
      p_operation: request.action,
      p_actor_id: userId,
      p_organization_id: request.organizationId,
      p_channel: request.channel,
      p_config_id: request.action === "update_draft" ? request.configId : null,
      p_revision: request.action === "create_draft" ? request.revision : null,
      p_flags: request.flags,
      p_messages: request.messages,
      p_settings: request.settings,
      p_min_version: request.minVersion,
      p_recommended_version: request.recommendedVersion,
      p_maintenance_mode: request.maintenanceMode,
      p_maintenance_message: request.maintenanceMessage,
    };
    // This RPC is separately approved and must write the draft and its audit record together or write neither.
    const { data, error } = await admin.rpc("lemtel_mobile_config_draft_write", rpcArguments);
    const row = rpcRow(data);
    if (error || !row) return response({ error: request.action === "create_draft" ? "draft_not_created" : "draft_not_updated" }, 409);
    return response({ draft: toDraftResponse(row) }, request.action === "create_draft" ? 201 : 200);
  }

  const transitionArguments = {
    p_operation: request.action,
    p_actor_id: userId,
    p_organization_id: request.organizationId,
    p_channel: request.channel,
    p_config_id: request.configId,
  };
  // Publication or retirement is delegated to the separately approved, organization-serialized RPC.
  const { data, error } = await admin.rpc("lemtel_mobile_config_publish", transitionArguments);
  const row = rpcRow(data);
  if (error || !row) return response({ error: request.action === "publish" ? "config_not_published" : "config_not_retired" }, 409);
  return response({ transition: toTransitionResponse(row) });
}
Deno.serve(handler);
