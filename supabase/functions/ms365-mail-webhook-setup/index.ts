// AVA — Crée un abonnement Microsoft Graph pour les nouveaux courriels du courtier.
// Auth : JWT du courtier. Stocke dans planipret_ava_mail_subscriptions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_MINUTES = 4230; // ~2.95 days, max pour /messages
const MS365_DELEGATED_SCOPES = "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite";

async function getMsConfig(admin: any) {
  const { data } = await admin.from("planipret_integration_secrets").select("config").eq("provider", "microsoft").maybeSingle();
  const c = (data?.config ?? {}) as Record<string, string>;
  return {
    clientId: c.client_id ?? Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
    clientSecret: c.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
    tenant: c.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? "common",
  };
}
async function refreshToken(admin: any, profile: any) {
  const cfg = await getMsConfig(admin);
  if (!profile.ms365_refresh_token) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token",
    refresh_token: profile.ms365_refresh_token,
    scope: MS365_DELEGATED_SCOPES,
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) return null;
  const d = await r.json();
  await admin.from("planipret_profiles").update({
    ms365_access_token: d.access_token,
    ms365_refresh_token: d.refresh_token ?? profile.ms365_refresh_token,
    ms365_scopes: d.scope ?? MS365_DELEGATED_SCOPES,
    ms365_token_expiry: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("id", profile.id);
  return d.access_token as string;
}
async function graph(admin: any, profile: any, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${profile.ms365_access_token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 401 && retry) {
    const t = await refreshToken(admin, profile);
    if (t) { profile.ms365_access_token = t; return graph(admin, profile, path, init, false); }
  }
  return r;
}

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return j({ success: false, error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("planipret_profiles")
      .select("id, user_id, ms365_access_token, ms365_refresh_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.ms365_access_token) return j({ success: false, error: "Microsoft 365 non connecté" }, 400);

    const projectId = Deno.env.get("SUPABASE_URL")!.replace("https://", "").split(".")[0];
    const notificationUrl = `https://${projectId}.functions.supabase.co/ms365-mail-webhook-receiver`;
    const clientState = crypto.randomUUID();
    const expiration = new Date(Date.now() + MAX_MINUTES * 60_000).toISOString();
    const resource = "/me/mailFolders('Inbox')/messages";

    // Remove old subs for this broker+resource to avoid duplicates
    const { data: existing } = await admin
      .from("planipret_ava_mail_subscriptions")
      .select("id, ms_subscription_id")
      .eq("broker_user_id", userId);
    for (const old of existing ?? []) {
      try { await graph(admin, profile, `/subscriptions/${old.ms_subscription_id}`, { method: "DELETE" }); } catch {}
      await admin.from("planipret_ava_mail_subscriptions").delete().eq("id", old.id);
    }

    const r = await graph(admin, profile, `/subscriptions`, {
      method: "POST",
      body: JSON.stringify({
        changeType: "created",
        notificationUrl,
        resource,
        expirationDateTime: expiration,
        clientState,
        latestSupportedTlsVersion: "v1_2",
      }),
    });
    const d = await r.json();
    if (!r.ok) return j({ success: false, error: `Graph subscription ${r.status}`, detail: d }, 500);

    const { data: inserted, error: iErr } = await admin.from("planipret_ava_mail_subscriptions").insert({
      broker_user_id: userId,
      broker_id: profile.id,
      ms_subscription_id: d.id,
      resource,
      client_state: clientState,
      notification_url: notificationUrl,
      expiration_datetime: d.expirationDateTime ?? expiration,
    }).select().single();
    if (iErr) throw iErr;

    return j({ success: true, subscription: inserted });
  } catch (e: any) {
    console.error("[ms365-mail-webhook-setup]", e);
    return j({ success: false, error: e?.message ?? "Erreur serveur" }, 500);
  }
});
