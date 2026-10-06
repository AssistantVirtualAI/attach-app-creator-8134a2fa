// Lemtel private contacts directory — source package only.
// Deployment, device-contact consent, and client cutover require separate approval.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const EXTERNAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 200;
const MAX_LIST_LIMIT = 100;
const ACTIONS = ["upsert_device", "list", "delete_device"] as const;
type Action = typeof ACTIONS[number];
type Failure = { error: string; status: number };
type ContactInput = { externalId: string; fullName: string; phoneE164: string; phoneLabel: string | null; email: string | null };
type RequestBody =
  | { action: "upsert_device"; organizationId: string; contacts: ContactInput[] }
  | { action: "list"; organizationId: string; limit: number }
  | { action: "delete_device"; organizationId: string };

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((key) => key in value);

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function validateContact(value: unknown): ContactInput | Failure {
  if (!plainObject(value) || !exactKeys(value, ["externalId", "fullName", "phoneE164", "phoneLabel", "email"])) return fail("invalid_contact", 400);
  if (!validText(value.externalId, 256) || !EXTERNAL_ID_RE.test(value.externalId)) return fail("invalid_contact", 400);
  if (!validText(value.fullName, 160)) return fail("invalid_contact", 400);
  if (typeof value.phoneE164 !== "string" || !E164_RE.test(value.phoneE164)) return fail("invalid_contact", 400);
  if (value.phoneLabel !== null && !validText(value.phoneLabel, 64)) return fail("invalid_contact", 400);
  if (value.email !== null && (typeof value.email !== "string" || value.email.length > 254 || !EMAIL_RE.test(value.email))) return fail("invalid_contact", 400);
  return {
    externalId: value.externalId,
    fullName: value.fullName.trim(),
    phoneE164: value.phoneE164,
    phoneLabel: value.phoneLabel === null ? null : value.phoneLabel.trim(),
    email: value.email === null ? null : value.email.trim().toLowerCase(),
  };
}

// Validation completes before authentication or database access and never echoes payload values.
export function validateBody(raw: unknown): RequestBody | Failure {
  if (!plainObject(raw) || typeof raw.action !== "string" || !(ACTIONS as readonly string[]).includes(raw.action)) return fail("invalid_body", 400);
  if (typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return fail("invalid_organization_id", 400);
  if (raw.action === "list") {
    if (!exactKeys(raw, ["action", "organizationId", "limit"]) || typeof raw.limit !== "number" || !Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > MAX_LIST_LIMIT) return fail("invalid_body", 400);
    return { action: "list", organizationId: raw.organizationId.toLowerCase(), limit: raw.limit };
  }
  if (raw.action === "delete_device") {
    if (!exactKeys(raw, ["action", "organizationId"])) return fail("invalid_body", 400);
    return { action: "delete_device", organizationId: raw.organizationId.toLowerCase() };
  }
  if (!exactKeys(raw, ["action", "organizationId", "contacts"]) || !Array.isArray(raw.contacts) || raw.contacts.length > MAX_CONTACTS) return fail("invalid_body", 400);
  const contacts: ContactInput[] = [];
  const seen = new Set<string>();
  for (const entry of raw.contacts) {
    const contact = validateContact(entry);
    if (isFailure(contact)) return contact;
    const key = `${contact.externalId}\u0000${contact.phoneE164}`;
    if (seen.has(key)) return fail("duplicate_contact", 400);
    seen.add(key);
    contacts.push(contact);
  }
  return { action: "upsert_device", organizationId: raw.organizationId.toLowerCase(), contacts };
}

function requireEnvironment(): { url: string; serviceRoleKey: string } | Failure {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return fail("server_not_configured", 503);
  return { url, serviceRoleKey };
}

async function authenticatedMember(admin: any, token: string, organizationId: string): Promise<string | Failure> {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return fail("unauthorized", 401);
  const { data: membership, error: membershipError } = await admin
    .from("lemtel_organization_memberships")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership) return fail("forbidden", 403);
  return userId;
}

function toContact(row: Record<string, unknown>) {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneE164: row.phone_e164,
    phoneLabel: row.phone_label,
    email: row.email,
    source: row.source,
    updatedAt: row.updated_at,
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
  const environment = requireEnvironment();
  if (isFailure(environment)) return respond({ error: environment.error }, environment.status);
  const admin = createClient(environment.url, environment.serviceRoleKey, { auth: { persistSession: false } });
  const userId = await authenticatedMember(admin, token, request.organizationId);
  if (isFailure(userId)) return respond({ error: userId.error }, userId.status);

  if (request.action === "list") {
    const { data, error } = await admin
      .from("lemtel_contacts")
      .select("id,full_name,phone_e164,phone_label,email,source,updated_at")
      .eq("organization_id", request.organizationId)
      .eq("owner_user_id", userId)
      .eq("source", "device")
      .order("updated_at", { ascending: false })
      .limit(request.limit);
    if (error) return respond({ error: "contacts_unavailable" }, 503);
    return respond({ contacts: (data ?? []).map((row) => toContact(row as Record<string, unknown>)) });
  }

  // One scoped DELETE removes only this authenticated owner's device rows in
  // the selected organization. It accepts no user id, contact id or source.
  if (request.action === "delete_device") {
    const { count, error } = await admin
      .from("lemtel_contacts")
      .delete({ count: "exact" })
      .eq("organization_id", request.organizationId)
      .eq("owner_user_id", userId)
      .eq("source", "device");
    if (error) return respond({ error: "contacts_not_deleted" }, 503);
    return respond({ deleted: count ?? 0, source: "device" });
  }

  if (request.contacts.length === 0) return respond({ accepted: 0, source: "device" }, 201);
  const updatedAt = new Date().toISOString();
  const rows = request.contacts.map((contact) => ({
    organization_id: request.organizationId,
    owner_user_id: userId,
    source: "device",
    external_id: contact.externalId,
    full_name: contact.fullName,
    phone_e164: contact.phoneE164,
    phone_label: contact.phoneLabel,
    email: contact.email,
    updated_at: updatedAt,
  }));
  const { error } = await admin
    .from("lemtel_contacts")
    .upsert(rows, { onConflict: "organization_id,owner_user_id,source,external_id,phone_e164", ignoreDuplicates: false });
  if (error) return respond({ error: "contacts_not_saved" }, 503);
  return respond({ accepted: rows.length, source: "device" }, 201);
}

Deno.serve(handler);
