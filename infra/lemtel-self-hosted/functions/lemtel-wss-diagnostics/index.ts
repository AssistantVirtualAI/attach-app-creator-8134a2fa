// Lemtel minimized WSS fallback telemetry — source package only.
// Raw WSS URLs, SIP credentials, response bodies, and arbitrary diagnostics are never accepted.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENDPOINT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FAILURE_CODES = ["timeout", "rejected", "closed", "tls", "unknown"] as const;
const STATES = ["ok", "fail"] as const;
type FailureCode = typeof FAILURE_CODES[number];
type State = typeof STATES[number];
type Failure = { error: string; status: number };
export type DiagnosticRequest = {
  organizationId: string;
  primaryEndpointId: string;
  fallbackEndpointId: string;
  primaryFailureCode: FailureCode;
  primaryLatencyMs: number;
  fallbackState: State;
  fallbackLatencyMs: number;
};

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((key) => key in value);
const validLatency = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 30000;

// Validation completes before authentication or database access and rejects any raw endpoint URL field.
export function validateBody(raw: unknown): DiagnosticRequest | Failure {
  const expected = ["organizationId", "primaryEndpointId", "fallbackEndpointId", "primaryFailureCode", "primaryLatencyMs", "fallbackState", "fallbackLatencyMs"];
  if (!plainObject(raw) || !exactKeys(raw, expected)) return fail("invalid_body", 400);
  if (typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return fail("invalid_organization_id", 400);
  if (typeof raw.primaryEndpointId !== "string" || !ENDPOINT_ID_RE.test(raw.primaryEndpointId)) return fail("invalid_endpoint", 400);
  if (typeof raw.fallbackEndpointId !== "string" || !ENDPOINT_ID_RE.test(raw.fallbackEndpointId) || raw.fallbackEndpointId === raw.primaryEndpointId) return fail("invalid_endpoint", 400);
  if (typeof raw.primaryFailureCode !== "string" || !(FAILURE_CODES as readonly string[]).includes(raw.primaryFailureCode)) return fail("invalid_failure_code", 400);
  if (typeof raw.fallbackState !== "string" || !(STATES as readonly string[]).includes(raw.fallbackState)) return fail("invalid_fallback_state", 400);
  if (!validLatency(raw.primaryLatencyMs) || !validLatency(raw.fallbackLatencyMs)) return fail("invalid_latency", 400);
  return {
    organizationId: raw.organizationId.toLowerCase(),
    primaryEndpointId: raw.primaryEndpointId,
    fallbackEndpointId: raw.fallbackEndpointId,
    primaryFailureCode: raw.primaryFailureCode as FailureCode,
    primaryLatencyMs: raw.primaryLatencyMs,
    fallbackState: raw.fallbackState as State,
    fallbackLatencyMs: raw.fallbackLatencyMs,
  };
}

function requireEnvironment(): { url: string; serviceRoleKey: string } | Failure {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return fail("server_not_configured", 503);
  return { url, serviceRoleKey };
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
  const environment = requireEnvironment();
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
  const { error } = await admin.from("lemtel_wss_diagnostic_events").insert({
    organization_id: request.organizationId,
    actor_user_id: userId,
    primary_endpoint_id: request.primaryEndpointId,
    fallback_endpoint_id: request.fallbackEndpointId,
    primary_failure_code: request.primaryFailureCode,
    primary_latency_ms: request.primaryLatencyMs,
    fallback_state: request.fallbackState,
    fallback_latency_ms: request.fallbackLatencyMs,
  });
  if (error) return respond({ error: "diagnostic_not_recorded" }, 503);
  return respond({ recorded: true }, 201);
}

Deno.serve(handler);
