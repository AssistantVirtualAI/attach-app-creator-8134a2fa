import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authUrl = Deno.env.get("MAESTRO_OAUTH_AUTHORIZE_URL") ?? "";
  const tokenUrl = Deno.env.get("MAESTRO_OAUTH_TOKEN_URL") ?? "";
  const clientId = Deno.env.get("MAESTRO_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("MAESTRO_OAUTH_CLIENT_SECRET") ?? "";
  const scope = Deno.env.get("MAESTRO_OAUTH_SCOPE") ?? "";

  const configured = !!(authUrl && tokenUrl && clientId && clientSecret);

  const { data: connected } = await admin
    .from("planipret_integration_secrets")
    .select("key_name, value, updated_at")
    .eq("provider", "maestro_oauth")
    .order("updated_at", { ascending: false })
    .limit(1);

  const { data: pending } = await admin
    .from("planipret_integration_secrets")
    .select("key_name, value, updated_at")
    .eq("provider", "maestro_oauth_pending")
    .order("updated_at", { ascending: false })
    .limit(5);

  let status: "connected" | "pending" | "not_configured" | "disconnected" = "disconnected";
  let lastConnectedAt: string | null = null;
  let expiresIn: number | null = null;

  if (connected && connected.length > 0) {
    status = "connected";
    lastConnectedAt = (connected[0] as any).updated_at ?? null;
    try {
      const parsed = JSON.parse((connected[0] as any).value ?? "{}");
      expiresIn = parsed?.expires_in ?? null;
    } catch { /* ignore */ }
  } else if (pending && pending.length > 0) {
    status = "pending";
  } else if (!configured) {
    status = "not_configured";
  }

  const origin = req.headers.get("origin") ?? "https://avastatistic.ca";
  const redirectUri = `${origin}/auth/maestro/callback`;

  let authorizeUrl: string | null = null;
  if (authUrl && clientId) {
    const u = new URL(authUrl);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    if (scope) u.searchParams.set("scope", scope);
    u.searchParams.set("state", crypto.randomUUID());
    authorizeUrl = u.toString();
  }

  return new Response(JSON.stringify({
    status,
    configured,
    last_connected_at: lastConnectedAt,
    expires_in: expiresIn,
    pending_count: pending?.length ?? 0,
    redirect_uri: redirectUri,
    authorize_url: authorizeUrl,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
