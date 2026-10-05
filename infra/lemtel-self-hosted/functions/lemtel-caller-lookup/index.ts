// Lemtel caller lookup — source package only.
// It returns only the signed-in member's own Lemtel private-directory match.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
type Failure = { error: string; status: number };
type LookupRequest = { organizationId: string; phone: string };

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  return E164_RE.test(compact) ? compact : null;
}

// Validation completes before authentication or database access and never echoes the caller number.
export function validateBody(raw: unknown): LookupRequest | Failure {
  if (!plainObject(raw) || Object.keys(raw).length !== 2 || !("organizationId" in raw) || !("phone" in raw)) return fail("invalid_body", 400);
  if (typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return fail("invalid_organization_id", 400);
  if (typeof raw.phone !== "string" || raw.phone.length > 64 || !normalizePhone(raw.phone)) return fail("invalid_phone", 400);
  return { organizationId: raw.organizationId.toLowerCase(), phone: normalizePhone(raw.phone)! };
}

function requireEnvironment(): { url: string; serviceRoleKey: string } | Failure {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return fail("server_not_configured", 503);
  return { url, serviceRoleKey };
}

function fallback(phone: string) {
  return { found: false, source: null, name: phone, display_number: phone, raw_number: phone, phone_normalized: phone };
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
  const { data, error } = await admin
    .from("lemtel_contacts")
    .select("full_name,phone_e164,email,source")
    .eq("organization_id", request.organizationId)
    .eq("owner_user_id", userId)
    .eq("phone_e164", request.phone)
    .eq("source", "device")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return respond({ error: "lookup_unavailable" }, 503);
  const contact = data?.[0] as Record<string, unknown> | undefined;
  if (!contact) return respond(fallback(request.phone));
  return respond({
    found: true,
    source: contact.source,
    name: contact.full_name,
    display_number: contact.phone_e164,
    raw_number: contact.phone_e164,
    phone_normalized: contact.phone_e164,
    email: contact.email ?? null,
  });
}

Deno.serve(handler);
