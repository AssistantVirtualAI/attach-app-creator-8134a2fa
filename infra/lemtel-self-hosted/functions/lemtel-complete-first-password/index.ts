// Lemtel first-password completion — source package only.
// A temporary password is accepted only to select a permanent password. The password is never logged or persisted outside Auth.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const fail = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function validPermanentPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  let body: unknown;
  try { body = await req.json(); } catch { return fail("invalid_json", 400); }
  if (!plainObject(body) || Object.keys(body).length !== 1 || !("newPassword" in body) || !validPermanentPassword(body.newPassword)) return fail("weak_password", 400);
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return fail("unauthorized", 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return fail("server_not_configured", 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return fail("unauthorized", 401);
  if (user.app_metadata?.lemtel_onboarding_required !== true || user.app_metadata?.lemtel_email_only_signin !== true) return fail("first_password_change_not_required", 409);
  const { data: activeMembership } = await admin.from("lemtel_organization_memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!activeMembership?.organization_id) return fail("lemtel_membership_required", 403);
  const nextAppMetadata = { ...(user.app_metadata ?? {}), lemtel_onboarding_required: false, lemtel_email_only_signin: true, lemtel_first_password_changed_at: new Date().toISOString() };
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: body.newPassword, app_metadata: nextAppMetadata });
  if (updateError) return fail("password_update_failed", 503);
  await admin.from("lemtel_onboarding_audit").insert({ organization_id: activeMembership.organization_id, actor_id: user.id, subject_user_id: user.id, action: "first_password_changed", metadata: {} });
  return respond({ ok: true, password_change_required: false });
}

Deno.serve(handler);
