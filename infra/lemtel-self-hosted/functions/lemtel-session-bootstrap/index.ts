// Lemtel session bootstrap — source package only.
// Returns Lemtel-owned identity metadata only. SIP, WSS, TURN, FusionPBX and secrets are intentionally excluded.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "GET") return respond({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return respond({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id || !user.email) return respond({ error: "unauthorized" }, 401);
  if (user.app_metadata?.lemtel_onboarding_required === true) return respond({ error: "first_password_change_required" }, 409);
  if (user.app_metadata?.lemtel_email_only_signin !== true) return respond({ error: "lemtel_email_only_account_required" }, 403);
  // Do not rely on an embedded PostgREST relationship here. Fresh self-hosted
  // schemas can briefly have a stale relationship cache immediately after a
  // migration even though both Lemtel-only tables and the membership are valid.
  const { data: memberships, error: membershipError } = await admin
    .from("lemtel_organization_memberships")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (membershipError || !memberships?.length) return respond({ error: "lemtel_membership_required" }, 403);
  const organizationIds = memberships.map((membership: Record<string, unknown>) => String(membership.organization_id));
  const { data: organizations, error: organizationError } = await admin
    .from("lemtel_organizations")
    .select("id,display_name,slug,status")
    .in("id", organizationIds)
    .eq("status", "active");
  if (organizationError || !organizations?.length) return respond({ error: "lemtel_active_organization_required" }, 403);
  const organizationById = new Map(organizations.map((organization: Record<string, unknown>) => [String(organization.id), organization]));
  const activeMemberships = memberships.filter((membership: Record<string, unknown>) => organizationById.has(String(membership.organization_id)));
  if (!activeMemberships.length) return respond({ error: "lemtel_active_organization_required" }, 403);
  return respond({
    user: { id: user.id, email: user.email, displayName: String(user.user_metadata?.full_name || user.email), locale: user.user_metadata?.locale === "en" ? "en" : "fr" },
    organizations: activeMemberships.map((membership: Record<string, unknown>) => ({ organizationId: membership.organization_id, role: membership.role, organization: organizationById.get(String(membership.organization_id)) })),
    telephony: { status: "not_provisioned" },
  });
}

Deno.serve(handler);
