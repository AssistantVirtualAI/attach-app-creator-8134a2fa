// Temporary read-only diagnostic: verifies that the AVA chatbot + voice bot
// are wired to the PRODUCTION Maestro API and to a live ElevenLabs agent.
// Returns booleans/labels only — never credentials.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const out: Record<string, unknown> = {};

  // --- Maestro telecom (production) ---
  const base = (Deno.env.get("MAESTRO_TELECOM_BASE_URL") ?? "").replace(/\/$/, "");
  let machineKey = "";
  let keySource = "none";
  try {
    const admin = (await import("npm:@supabase/supabase-js@2")).createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin.from("planipret_integration_secrets")
      .select("config").eq("provider", "maestro_telecom").maybeSingle();
    if ((data as any)?.config?.api_key) { machineKey = (data as any).config.api_key; keySource = "db"; }
  } catch { /* ignore */ }
  if (!machineKey) {
    machineKey = Deno.env.get("MAESTRO_MACHINE_API_KEY") ?? Deno.env.get("MAESTRO_TELECOM_API_KEY") ?? "";
    keySource = machineKey ? "env" : "none";
  }
  out.maestro_key_source = keySource;
  out.maestro_base_url = base;
  out.maestro_key_present = !!machineKey;
  try {
    const r = await fetch(`${base}/users/393?machine=1`, {
      headers: { Authorization: `Bearer ${machineKey}`, Accept: "application/json" },
    });
    out.maestro_status = r.status;
    await r.text();
  } catch (e) {
    out.maestro_status = `error: ${(e as Error).message}`;
  }

  // --- Maestro OAuth (production) ---
  out.maestro_oauth_authorize = Deno.env.get("MAESTRO_OAUTH_AUTHORIZE_URL") ?? null;
  const tokenUrl = Deno.env.get("MAESTRO_OAUTH_TOKEN_URL") ?? "";
  out.maestro_oauth_token = tokenUrl || null;
  if (tokenUrl) {
    try {
      const r = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code" }),
      });
      out.maestro_oauth_status = r.status; // 400 = endpoint live (validation error)
      await r.text();
    } catch (e) {
      out.maestro_oauth_status = `error: ${(e as Error).message}`;
    }
  }

  // --- ElevenLabs ---
  const el = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  const agentId = Deno.env.get("ELEVENLABS_DEFAULT_AGENT_ID") ?? "";
  out.elevenlabs_key_present = !!el;
  out.elevenlabs_default_agent_id = agentId || null;
  if (el) {
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": el } });
      out.elevenlabs_account_status = r.status;
      await r.text();
    } catch (e) {
      out.elevenlabs_account_status = `error: ${(e as Error).message}`;
    }
  }
  if (el && agentId) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`, {
        headers: { "xi-api-key": el },
      });
      out.elevenlabs_agent_status = r.status;
      if (r.ok) {
        const a = await r.json();
        const prompt = a?.conversation_config?.agent?.prompt ?? {};
        out.elevenlabs_agent_name = a?.name ?? null;
        out.elevenlabs_agent_llm = prompt?.llm ?? null;
        out.elevenlabs_agent_tools = (prompt?.tools ?? []).map((t: any) => ({
          name: t?.name,
          type: t?.type,
          url: t?.api_schema?.url ?? null,
        }));
        out.elevenlabs_agent_tool_ids = prompt?.tool_ids ?? [];
      } else {
        await r.text();
      }
    } catch (e) {
      out.elevenlabs_agent_status = `error: ${(e as Error).message}`;
    }
  }

  // --- Lovable AI (chatbot) ---
  out.lovable_api_key_present = !!Deno.env.get("LOVABLE_API_KEY");

  return j(out);
});
