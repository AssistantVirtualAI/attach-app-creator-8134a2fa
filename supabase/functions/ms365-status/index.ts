// ms365-status — Lightweight combined status of Microsoft 365 for badge/diagnostics UI.
// Returns: user token state, admin config detection, last saved test.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return j({ error: "unauthorized" }, 401);

    const [{ data: profile }, { data: secret }, { data: cfg }] = await Promise.all([
      admin
        .from("planipret_profiles")
        .select("ms365_access_token, ms365_refresh_token, ms365_token_expiry, ms365_email, ms365_scopes")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("planipret_integration_secrets")
        .select("config")
        .in("provider", ["microsoft", "ms365"])
        .limit(1)
        .maybeSingle(),
      admin
        .from("planipret_integration_config")
        .select("last_tested_at, last_test_success, last_test_result")
        .eq("integration_key", "ms365")
        .maybeSingle(),
    ]);

    const c = (secret?.config ?? {}) as Record<string, string>;
    const detection = {
      tenant_id: c.tenant_id ?? null,
      client_id: c.client_id ?? null,
      has_secret: !!c.client_secret,
    };

    const expiry = profile?.ms365_token_expiry ? new Date(profile.ms365_token_expiry).getTime() : 0;
    const now = Date.now();
    const user = {
      connected: !!profile?.ms365_access_token,
      email: profile?.ms365_email ?? null,
      has_refresh: !!profile?.ms365_refresh_token,
      expired: expiry > 0 && expiry < now,
      expires_in_sec: expiry > 0 ? Math.round((expiry - now) / 1000) : null,
      scopes: (profile?.ms365_scopes ?? "").split(/\s+/).filter(Boolean),
    };

    const admin_cfg_ok = !!(detection.tenant_id && detection.client_id && detection.has_secret);
    const last = cfg
      ? { tested_at: cfg.last_tested_at, success: cfg.last_test_success, message: cfg.last_test_result }
      : null;

    // status: ok | limited | down
    let status: "ok" | "limited" | "down" = "down";
    if (admin_cfg_ok && user.connected && !user.expired) status = "ok";
    else if (admin_cfg_ok && (user.connected || last?.success)) status = "limited";
    else if (admin_cfg_ok) status = "limited";
    else status = "down";

    return j({ status, detection, user, last, admin_cfg_ok });
  } catch (e) {
    return j({ error: String((e as Error).message ?? e) }, 500);
  }
});
