// Lemtel-only published mobile configuration manifest — source package only.
// Deployment and client cutover require separate approval after synthetic validation.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = ["staging", "production"] as const;
const SENSITIVE_KEY_RE = /(?:pass(?:word)?|secret|token|credential|authorization|api[_-]?key|private|sip|turn|wss|endpoint|host|url)/i;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 5;
const MAX_JSON_KEYS = 50;
const MAX_MESSAGE_LENGTH = 512;

export type Channel = typeof CHANNELS[number];
type Failure = { error: string; status: number };
type JsonRecord = Record<string, string | number | boolean | null | JsonRecord>;
export type ManifestRequest = { organizationId: string; channel: Channel };

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function safeConfigObject(value: unknown, depth = 0): value is JsonRecord {
  if (!plainObject(value) || depth > MAX_JSON_DEPTH || Object.keys(value).length > MAX_JSON_KEYS) return false;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_JSON_BYTES) return false; } catch { return false; }
  for (const [key, child] of Object.entries(value)) {
    if (!key || key.length > 80 || SENSITIVE_KEY_RE.test(key)) return false;
    if (typeof child === "string" && child.length > MAX_MESSAGE_LENGTH) return false;
    if (child !== null && !["string", "number", "boolean"].includes(typeof child) && !safeConfigObject(child, depth + 1)) return false;
  }
  return true;
}

// Validation occurs before authentication or database access and never echoes request values.
export function validateBody(raw: unknown): ManifestRequest | Failure {
  if (!plainObject(raw) || Object.keys(raw).length !== 2 || !("organizationId" in raw) || !("channel" in raw)) return fail("invalid_body", 400);
  if (typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return fail("invalid_organization_id", 400);
  if (typeof raw.channel !== "string" || !(CHANNELS as readonly string[]).includes(raw.channel)) return fail("invalid_channel", 400);
  return { organizationId: raw.organizationId.toLowerCase(), channel: raw.channel as Channel };
}

function requiredEnvironment(): { url: string; serviceRoleKey: string } | Failure {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return fail("server_not_configured", 503);
  return { url, serviceRoleKey };
}

export function toManifest(row: Record<string, unknown>) {
  return {
    schemaVersion: "lemtel_mobile_config_manifest_v1",
    channel: row.channel,
    revision: row.revision,
    flags: row.flags,
    messages: row.messages,
    settings: row.settings,
    minVersion: row.min_version,
    recommendedVersion: row.recommended_version,
    maintenanceMode: row.maintenance_mode,
    maintenanceMessage: row.maintenance_message,
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);

  let raw: unknown;
  try { raw = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const request = validateBody(raw);
  if (isFailure(request)) return respond({ error: request.error }, request.status);

  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return respond({ error: "unauthorized" }, 401);
  const environment = requiredEnvironment();
  if (isFailure(environment)) return respond({ error: environment.error }, environment.status);
  const admin = createClient(environment.url, environment.serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return respond({ error: "unauthorized" }, 401);

  const { data: membership, error: membershipError } = await admin
    .from("lemtel_organization_memberships")
    .select("status")
    .eq("organization_id", request.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership) return respond({ error: "forbidden" }, 403);

  const SELECT_COLUMNS = "channel,revision,flags,messages,settings,min_version,recommended_version,maintenance_mode,maintenance_message";
  const { data, error } = await admin
    .from("lemtel_mobile_config_revisions")
    .select(SELECT_COLUMNS)
    .eq("organization_id", request.organizationId)
    .eq("channel", request.channel)
    .eq("status", "published")
    .maybeSingle();
  if (error || !data) return respond({ error: "configuration_unavailable" }, 404);
  const row = data as Record<string, unknown>;
  if (!safeConfigObject(row.flags) || !safeConfigObject(row.messages) || !safeConfigObject(row.settings)) return respond({ error: "configuration_unavailable" }, 503);
  return respond(toManifest(row));
}

Deno.serve(handler);
