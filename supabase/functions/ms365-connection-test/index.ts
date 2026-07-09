// Live Microsoft 365 connection test using app-only OAuth2 (client_credentials).
// Returns { summary, results } with 5 sub-tests. CORS enabled.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const adminUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let saved: Record<string, string> = {};
  if (adminUrl && serviceRole) {
    try {
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      const admin = createClient(adminUrl, serviceRole);
      const [{ data: secret }, { data: cfg }] = await Promise.all([
        admin.from("planipret_integration_secrets").select("config").in("provider", ["microsoft", "ms365"]).limit(1).maybeSingle(),
        admin.from("planipret_integration_config").select("config_data").eq("integration_key", "ms365").maybeSingle(),
      ]);
      saved = { ...((cfg?.config_data ?? {}) as Record<string, string>), ...((secret?.config ?? {}) as Record<string, string>) };
    } catch (e) { console.error("ms365 config read failed", e); }
  }
  const TENANT_ID = saved.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? "";
  const CLIENT_ID = saved.client_id ?? saved.client_secret_id ?? Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
  const CLIENT_SECRET = saved.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";

  const results: Record<string, any> = {};

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    return new Response(
      JSON.stringify({
        summary: {
          total_tests: 0,
          passed: 0,
          failed: 1,
          tested_at: new Date().toISOString(),
          elapsed_ms: Date.now() - startedAt,
          tenant_id: TENANT_ID || null,
          client_id: CLIENT_ID ? CLIENT_ID.substring(0, 8) + "..." : null,
        },
        results: {
          config: {
            success: false,
            message: "❌ Secrets manquants",
            missing: [
              !TENANT_ID && "MICROSOFT_TENANT_ID",
              !CLIENT_ID && "MICROSOFT_CLIENT_ID",
              !CLIENT_SECRET && "MICROSOFT_CLIENT_SECRET",
            ].filter(Boolean),
          },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let appToken = "";

  // TEST 1 — app-only token
  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      appToken = tokenData.access_token;
      results.auth = {
        success: true,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        message: `✅ Token obtenu — expire dans ${tokenData.expires_in}s`,
      };
    } else {
      results.auth = {
        success: false,
        error: tokenData.error,
        error_description: tokenData.error_description,
        message: `❌ Échec auth: ${tokenData.error_description ?? tokenData.error ?? "inconnu"}`,
      };
    }
  } catch (e) {
    results.auth = {
      success: false,
      error: String(e),
      message: `❌ Erreur réseau: ${String(e)}`,
    };
  }

  if (appToken) {
    // TEST 2 — organization
    try {
      const r = await fetch("https://graph.microsoft.com/v1.0/organization", {
        headers: { Authorization: `Bearer ${appToken}` },
      });
      const d = await r.json();
      const org = d.value?.[0];
      const msg = d.error?.message ?? "erreur";
      results.organization = {
        success: r.ok && !!org,
        category: "admin_directory",
        required: "Application permission Organization.Read.All ou rôle Microsoft admin/Global Reader",
        display_name: org?.displayName,
        tenant_id: org?.id,
        country: org?.countryLetterCode,
        verified_domains: org?.verifiedDomains?.map((v: any) => v.name),
        message: r.ok
          ? `✅ Organisation: ${org?.displayName}`
          : `⚠️ ${msg}`,
        recommendation: r.ok ? undefined : "Les fonctions Mail/Calendar/Teams peuvent fonctionner même si ce test directory échoue. Donnez un rôle Microsoft admin/Global Reader ou une permission application pour ce diagnostic.",
      };
    } catch (e) {
      results.organization = { success: false, error: String(e), message: `❌ ${String(e)}` };
    }

    // TEST 3 — users
    try {
      const r = await fetch(
        "https://graph.microsoft.com/v1.0/users?$top=5&$select=displayName,mail,userPrincipalName",
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      const d = await r.json();
      results.users = {
        success: r.ok,
        category: "admin_directory",
        required: "Application permission User.Read.All ou rôle Microsoft admin/Global Reader",
        count: d.value?.length ?? 0,
        sample: d.value?.map((u: any) => ({
          name: u.displayName,
          email: u.mail || u.userPrincipalName,
        })),
        message: r.ok
          ? `✅ ${d.value?.length ?? 0} utilisateurs trouvés`
          : `⚠️ ${d.error?.message ?? "erreur"}`,
        recommendation: r.ok ? undefined : "Ce test vérifie l'annuaire Microsoft. Il n'empêche pas la connexion utilisateur OAuth ni Outlook/Calendar/Teams délégués.",
      };
    } catch (e) {
      results.users = { success: false, error: String(e), message: `❌ ${String(e)}` };
    }

    // TEST 4 — app registration + redirect URIs
    try {
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/applications?$filter=appId eq '${CLIENT_ID}'&$select=displayName,web,spa,publicClient`,
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      const d = await r.json();
      const app = d.value?.[0];
      results.app_registration = {
        success: r.ok && !!app,
        category: "admin_directory",
        required: "Application.Read.All ou rôle Application Administrator/Global Reader",
        app_name: app?.displayName,
        redirect_uris_web: app?.web?.redirectUris ?? [],
        redirect_uris_spa: app?.spa?.redirectUris ?? [],
        redirect_uris_public: app?.publicClient?.redirectUris ?? [],
        message: app
          ? `✅ App: ${app.displayName}`
          : "⚠️ App non trouvée ou permissions insuffisantes",
        recommendation: app ? undefined : "Ce test lit la configuration Azure App Registration. Si les redirect URIs sont déjà configurées, l'OAuth utilisateur peut fonctionner malgré cette limite.",
      };
    } catch (e) {
      results.app_registration = { success: false, error: String(e), message: `❌ ${String(e)}` };
    }

    // TEST 5 — service principal / permissions
    try {
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${CLIENT_ID}'&$select=displayName,appRoles`,
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      const d = await r.json();
      results.permissions = {
        success: r.ok,
        category: "admin_directory",
        required: "Application.Read.All ou rôle Application Administrator/Global Reader",
        service_principal: d.value?.[0]?.displayName,
        app_roles_count: d.value?.[0]?.appRoles?.length ?? 0,
        message: r.ok
          ? "✅ Permissions vérifiées"
          : `❌ ${d.error?.message ?? "erreur"}`,
      };
    } catch (e) {
      results.permissions = { success: false, error: String(e), message: `❌ ${String(e)}` };
    }
  }

  const summary = {
    total_tests: Object.keys(results).length,
    passed: Object.values(results).filter((r: any) => r.success).length,
    failed: Object.values(results).filter((r: any) => !r.success).length,
    core_passed: !!results.auth?.success,
    admin_directory_failed: Object.values(results).filter((r: any) => !r.success && r.category === "admin_directory").length,
    status: results.auth?.success ? "core_connected" : "not_connected",
    tested_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    tenant_id: TENANT_ID,
    client_id: CLIENT_ID.substring(0, 8) + "...",
  };

  return new Response(JSON.stringify({ summary, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
