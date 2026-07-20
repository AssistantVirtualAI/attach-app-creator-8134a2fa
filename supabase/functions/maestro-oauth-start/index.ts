// maestro-oauth-start — authenticated. Generates a state, links it to the
// current broker, returns the authorize URL. Use this instead of building the
// URL client-side so the callback can resolve which user connected.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMaestroOAuthEnv, isMaestroOAuthConfigured } from "../_shared/maestro-oauth.ts";

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return j({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as any));
    const origin = body?.origin ?? req.headers.get("origin") ?? "https://avastatistic.ca";
    const redirectUri = body?.redirect_uri ?? `${origin}/auth/maestro/callback`;

    const env = getMaestroOAuthEnv();
    if (!isMaestroOAuthConfigured(env)) return j({ error: "not_configured" }, 200);

    const state = crypto.randomUUID();
    await admin.from("planipret_maestro_oauth_states").insert({
      state, user_id: u.user.id, redirect_uri: redirectUri,
    });

    const url = new URL(env.authUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    if (env.scope) url.searchParams.set("scope", env.scope);
    url.searchParams.set("state", state);

    return j({ ok: true, authorize_url: url.toString(), state, redirect_uri: redirectUri });
  } catch (e) {
    console.error("[maestro-oauth-start]", e);
    return j({ error: (e as Error).message }, 500);
  }
});
