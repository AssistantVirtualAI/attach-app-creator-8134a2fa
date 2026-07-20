import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { code, state, redirect_uri } = body ?? {};

    if (!code) {
      return new Response(JSON.stringify({ success: false, error: "code required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authUrl = Deno.env.get("MAESTRO_OAUTH_AUTHORIZE_URL") ?? "";
    const tokenUrl = Deno.env.get("MAESTRO_OAUTH_TOKEN_URL") ?? "";
    const clientId = Deno.env.get("MAESTRO_OAUTH_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("MAESTRO_OAUTH_CLIENT_SECRET") ?? "";

    // Log the incoming callback for debugging until endpoints are configured
    console.log("[maestro-oauth-callback] received", {
      hasCode: !!code, state, redirect_uri,
      configured: { authUrl: !!authUrl, tokenUrl: !!tokenUrl, clientId: !!clientId, clientSecret: !!clientSecret },
    });

    if (!tokenUrl || !clientId || !clientSecret) {
      // Store the raw code so we can exchange later once Scott provides endpoints
      await admin.from("planipret_integration_secrets").upsert({
        provider: "maestro_oauth_pending",
        key_name: `code_${state ?? Date.now()}`,
        value: JSON.stringify({ code, state, redirect_uri, received_at: new Date().toISOString() }),
      }, { onConflict: "provider,key_name" });

      return new Response(JSON.stringify({
        success: true,
        pending: true,
        message: "Code stocké. En attente de configuration des endpoints Maestro (MAESTRO_OAUTH_TOKEN_URL, MAESTRO_OAUTH_CLIENT_ID, MAESTRO_OAUTH_CLIENT_SECRET).",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Exchange authorization code for access token
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect_uri ?? "",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error("[maestro-oauth-callback] token exchange failed", tokenRes.status, tokenJson);
      const errMsg = tokenJson?.error_description ?? tokenJson?.error ?? `HTTP ${tokenRes.status}`;
      await admin.from("planipret_integration_secrets").upsert({
        provider: "maestro_oauth_error",
        key_name: "last",
        value: JSON.stringify({ error: errMsg, http_status: tokenRes.status, at: new Date().toISOString(), raw: tokenJson }),
      }, { onConflict: "provider,key_name" });
      return new Response(JSON.stringify({ success: false, error: errMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear any previous error
    await admin.from("planipret_integration_secrets").delete()
      .eq("provider", "maestro_oauth_error");

    // Store the tokens
    await admin.from("planipret_integration_secrets").upsert({
      provider: "maestro_oauth",
      key_name: state ?? "default",
      value: JSON.stringify({ ...tokenJson, obtained_at: new Date().toISOString() }),
    }, { onConflict: "provider,key_name" });

    return new Response(JSON.stringify({ success: true, has_refresh: !!tokenJson.refresh_token, expires_in: tokenJson.expires_in }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[maestro-oauth-callback] error", e);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

