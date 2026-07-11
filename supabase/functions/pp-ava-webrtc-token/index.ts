// Mint a WebRTC conversation token for the authenticated broker's own
// ElevenLabs Convai agent. Keeps ELEVENLABS_API_KEY server-side.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// naive per-IP+user rate limit (10/min)
const bucket = new Map<string, { n: number; reset: number }>();
function allow(k: string, max = 10, win = 60_000): boolean {
  const now = Date.now();
  const b = bucket.get(k);
  if (!b || now > b.reset) { bucket.set(k, { n: 1, reset: now + win }); return true; }
  if (b.n >= max) return false;
  b.n++; return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!ELEVENLABS_API_KEY) return json({ error: "elevenlabs_not_configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const jwt = authHeader.slice(7);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!allow(`${ip}:${userRes.user.id}`)) return json({ error: "rate_limited" }, 429);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: prof } = await admin
      .from("planipret_profiles")
      .select("elevenlabs_agent_id, voice_agent_enabled, full_name, extension")
      .eq("user_id", userRes.user.id)
      .maybeSingle();

    if (!prof) return json({ error: "profile_not_found" }, 404);
    if (!prof.voice_agent_enabled) return json({ error: "voice_agent_disabled" }, 403);
    if (!prof.elevenlabs_agent_id) return json({ error: "agent_not_provisioned" }, 409);

    const [tokenRes, signedRes] = await Promise.all([
      fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(prof.elevenlabs_agent_id)}`,
        { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
      ),
      fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(prof.elevenlabs_agent_id)}`,
        { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
      ),
    ]);

    const tokenText = await tokenRes.text();
    const signedText = await signedRes.text();

    if (!tokenRes.ok && !signedRes.ok) {
      console.error("elevenlabs token error", tokenRes.status, tokenText, signedRes.status, signedText);
      return json({ error: "elevenlabs_error", status: tokenRes.status, details: tokenText.slice(0, 500) }, 502);
    }

    const tokenData = tokenRes.ok ? JSON.parse(tokenText) : null;
    const signedData = signedRes.ok ? JSON.parse(signedText) : null;

    return json({
      token: tokenData?.token ?? null,
      signed_url: signedData?.signed_url ?? null,
      agent_id: prof.elevenlabs_agent_id,
      broker: { name: prof.full_name, extension: prof.extension },
    });
  } catch (e) {
    console.error("pp-ava-webrtc-token", e);
    return json({ error: (e as Error).message ?? "internal_error" }, 500);
  }
});
