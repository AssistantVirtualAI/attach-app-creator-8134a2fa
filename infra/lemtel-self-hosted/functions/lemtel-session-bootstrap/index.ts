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
  // Resolve membership and organization status atomically in PostgreSQL. This avoids
  // transient multi-request PostgREST inconsistencies after a self-hosted schema reload.
  const { data: context, error: contextError } = await admin.rpc("lemtel_session_bootstrap_context", { p_user_id: user.id });
  if (contextError || !context?.length) return respond({ error: "lemtel_active_organization_required" }, 403);
  const authorityRevision = context.reduce((current: number, entry: Record<string, unknown>) => {
    const revision = Number(entry.account_authority_revision);
    return Number.isSafeInteger(revision) && revision > current ? revision : current;
  }, 0);
  return respond({
    user: { id: user.id, email: user.email, displayName: String(user.user_metadata?.full_name || user.email), locale: user.user_metadata?.locale === "en" ? "en" : "fr" },
    organizations: context.map((entry: Record<string, unknown>) => ({
      organizationId: entry.organization_id,
      role: entry.membership_role,
      organization: {
        id: entry.organization_id,
        display_name: entry.organization_display_name,
        slug: entry.organization_slug,
        status: "active",
        account_authority_revision: entry.account_authority_revision,
      },
    })),
    authority: { policy: "portal_only_active_membership", revision: authorityRevision },
    telephony: { status: "not_provisioned" },
  });
}

Deno.serve(handler);
