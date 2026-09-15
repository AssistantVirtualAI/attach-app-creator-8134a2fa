// pp-ai-consent : statut / acceptation / révocation du consentement IA.
// Le consentement est persistant, versionné et lié au courtier authentifié.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AI_CONSENT_VERSION, evaluateConsent, getAiConsent } from "../_shared/ai-consent.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7).trim();
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) return json({ error: "unauthorized" }, 401);

    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = String((body as any)?.action ?? "status").toLowerCase();

    if (action === "status") {
      return json({ success: true, consent: await getAiConsent(admin, user.id) });
    }

    if (action !== "accept" && action !== "revoke") return json({ error: "invalid_action" }, 400);

    const now = new Date().toISOString();
    const patch = action === "accept"
      ? { ai_consent_at: now, ai_consent_version: AI_CONSENT_VERSION, ai_consent_revoked_at: null }
      : { ai_consent_revoked_at: now };

    const { data: rows, error } = await admin
      .from("planipret_profiles")
      .update(patch)
      .eq("user_id", user.id)
      .select("ai_consent_at, ai_consent_version, ai_consent_revoked_at");

    if (error) return json({ error: "consent_write_failed", detail: error.message }, 500);
    if (!rows || rows.length === 0) return json({ error: "profile_not_found" }, 404);

    return json({ success: true, action, consent: evaluateConsent(rows[0]) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
