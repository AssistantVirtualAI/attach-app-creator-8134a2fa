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
  // Resolve membership and client-family access atomically in PostgreSQL. This avoids
  // transient multi-request PostgREST inconsistencies after an access revocation.
  // No device identifier, network metadata or client-supplied tenant scope is accepted.
  const requestedClient = (req.headers.get("X-Lemtel-Client") ?? "").toLowerCase();
  const clientKind = requestedClient === "mobile" || requestedClient === "desktop" || requestedClient === "portal"
    ? requestedClient
    : "client";
  const { data: context, error: contextError } = await admin.rpc("lemtel_session_bootstrap_context_for_client", { p_user_id: user.id, p_client_kind: clientKind });
  if (contextError || !context?.length) return respond({ error: "lemtel_active_client_access_required" }, 403);
  const authorityRevision = context.reduce((current: number, entry: Record<string, unknown>) => {
    const revision = Number(entry.account_authority_revision);
    return Number.isSafeInteger(revision) && revision > current ? revision : current;
  }, 0);
  // Presence is observational only: authentication and authorization remain entirely
  // determined by the authoritative context above.
  try {
    await admin.rpc("lemtel_record_authorized_client_connection", {
      p_user_id: user.id,
      p_client_kind: clientKind,
    });
  } catch {
    // Presence remains best-effort and can never deny an otherwise valid session.
  }
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
