import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MS365_DELEGATED_SCOPES = "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite";

function microsoftOAuthErrorMessage(details: any) {
  const description = String(details?.error_description ?? "");
  if (details?.suberror === "consent_required" || details?.error_codes?.includes(65001) || description.includes("AADSTS65001")) {
    return "Microsoft demande un consentement pour les permissions demandées. Un administrateur Microsoft doit approuver l'application AVA Soft Phone, ou autoriser le consentement utilisateur dans Entra.";
  }
  if (description.includes("AADSTS50011") || /redirect_uri/i.test(description)) {
    return "L'adresse de redirection Microsoft ne correspond pas exactement à celle configurée dans Entra.";
  }
  return description || details?.error || "Échec OAuth Microsoft";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub;
    if (!userId) return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) return new Response(JSON.stringify({ success: false, error: "missing code/redirect_uri" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [{ data: ms }, { data: cfg }] = await Promise.all([
      admin.from("planipret_integration_secrets").select("config").in("provider", ["microsoft", "ms365"]).limit(1).maybeSingle(),
      admin.from("planipret_integration_config").select("config_data").eq("integration_key", "ms365").maybeSingle(),
    ]);
    const c = { ...((cfg?.config_data ?? {}) as Record<string, string>), ...((ms?.config ?? {}) as Record<string, string>) };
    const clientId = c.client_id ?? c.client_secret_id ?? Deno.env.get("MICROSOFT_CLIENT_ID");
    const clientSecret = c.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET");
    const tenant = c.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? "common";
    if (!clientId || !clientSecret) return new Response(JSON.stringify({ success: false, error: "MS365 non configuré côté admin" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const requestedScope = MS365_DELEGATED_SCOPES;
    const body = new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code",
      code, redirect_uri, scope: requestedScope,
    });
    console.log("[ms365-oauth-exchange] token request", { tenant, redirect_uri, clientId: clientId?.slice(0, 8) });
    const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const d = await r.json();
    if (!r.ok) {
      console.error("[ms365-oauth-exchange] MS token error", r.status, JSON.stringify(d));
      return new Response(JSON.stringify({ success: false, error: microsoftOAuthErrorMessage(d), details: d }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${d.access_token}` },
    });
    const me = await meRes.json().catch(() => ({}));

    await admin.from("planipret_profiles").update({
      ms365_access_token: d.access_token,
      ms365_refresh_token: d.refresh_token,
      ms365_scopes: d.scope ?? requestedScope,
      ms365_token_expiry: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000).toISOString(),
      ms365_email: me?.mail ?? me?.userPrincipalName ?? null,
    }).eq("user_id", userId);
    return new Response(JSON.stringify({ success: true, account: { email: me?.mail ?? me?.userPrincipalName ?? null, name: me?.displayName ?? null }, scopes: d.scope ?? requestedScope }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[ms365-oauth-exchange] unhandled", e?.message, e?.stack);
    return new Response(JSON.stringify({ success: false, error: e?.message ?? "Erreur" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
