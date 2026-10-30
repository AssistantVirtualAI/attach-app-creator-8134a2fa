// Super-admin preview of ava-agent-config for any broker (test/simulation).
// Returns the same shape as ava-agent-config but for a target user_id.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AVA_PROMPT_VERSION, avaFirstName, buildAvaFirstMessage, buildAvaPrompt } from "../_shared/ava-prompt.ts";
import { EXPECTED_TOOL_NAMES } from "../_shared/ava-tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEFAULT_AGENT_ID = Deno.env.get("ELEVENLABS_DEFAULT_AGENT_ID") ?? "";
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica — voix unique

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ success: false, error: "unauthorized" }, 401);
    const jwt = authHeader.slice(7);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ success: false, error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: isSuper }, { data: isPpAdmin }] = await Promise.all([
      admin.rpc("is_super_admin", { _user_id: userRes.user.id }),
      admin.rpc("is_planipret_admin", { _user_id: userRes.user.id }),
    ]);
    if (!isSuper && !isPpAdmin) return json({ success: false, error: "forbidden_admin_only" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.target_user_id ?? "");
    if (!targetUserId) {
      // Return list of brokers instead
      const { data: brokers } = await admin
        .from("planipret_profiles")
        .select("user_id, full_name, extension, voice_agent_enabled")
        .order("full_name", { ascending: true })
        .limit(200);
      return json({ success: true, brokers: brokers ?? [] });
    }

    const { data: p } = await admin
      .from("planipret_profiles")
      .select("user_id, full_name, extension, elevenlabs_agent_id, ava_voice_id, ava_preferred_lang, voice_agent_enabled, ava_autonomy_mode, ms365_access_token, maestro_connected, maestro_broker_id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!p) return json({ success: false, error: "profile_not_found" }, 404);

    // Mirror runtime: shared agent and shared Jessica voice for everyone.
    const agentId = DEFAULT_AGENT_ID || p.elevenlabs_agent_id;
    const voiceId = DEFAULT_VOICE_ID;
    const firstName = avaFirstName(p.full_name);
    const lang: "fr" | "en" = p.ava_preferred_lang === "en" ? "en" : "fr";

    // Read-only agent probe (no secrets returned).
    const overrides_allowed = { prompt: false, first_message: false, language: false, voice: false };
    let agent_status: string | null = null;
    let attached_tool_count: number | null = null;
    let agent_voice_id: string | null = null;
    const key = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
    if (key && agentId) {
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`, { headers: { "xi-api-key": key } });
        if (r.ok) {
          const agent = await r.json();
          const ov = agent?.platform_settings?.overrides?.conversation_config_override ?? {};
          overrides_allowed.prompt = !!ov?.agent?.prompt?.prompt;
          overrides_allowed.first_message = !!ov?.agent?.first_message;
          overrides_allowed.language = !!ov?.agent?.language;
          overrides_allowed.voice = !!ov?.tts?.voice_id;
          agent_status = Object.values(overrides_allowed).every(Boolean) ? "ok" : "overrides_incomplete_admin_sync_required";
          const pr = agent?.conversation_config?.agent?.prompt ?? {};
          const ids = Array.isArray(pr.tool_ids) ? pr.tool_ids.length : 0;
          const inline = Array.isArray(pr.tools) ? pr.tools.length : 0;
          attached_tool_count = Math.max(ids, inline);
          agent_voice_id = agent?.conversation_config?.tts?.voice_id ?? null;
        } else {
          agent_status = `error_${r.status}`;
        }
      } catch (_e) {
        agent_status = "probe_failed";
      }
    } else {
      agent_status = agentId ? "api_key_missing" : "agent_id_missing";
    }

    return json({
      success: true,
      target_user_id: targetUserId,
      broker: {
        full_name: p.full_name,
        first_name: firstName,
        extension: p.extension,
        voice_agent_enabled: p.voice_agent_enabled,
        ms365_connected: !!p.ms365_access_token,
        maestro_connected: !!p.maestro_connected,
      },
      agent_id: agentId,
      voice_id: voiceId,
      voice_name: "Jessica",
      agent_voice_id,
      language: lang,
      autonomy_mode: "confirm",
      first_message: buildAvaFirstMessage(p.full_name, lang),
      system_prompt: buildAvaPrompt(p, lang),
      prompt_version: AVA_PROMPT_VERSION,
      agent_status,
      overrides_allowed,
      expected_tool_count: EXPECTED_TOOL_NAMES.length,
      attached_tool_count,
      dynamic_variables: {
        ava_broker_name: p.full_name ?? "",
        ava_broker_first_name: firstName,
        ava_broker_extension: p.extension ?? "",
      },
    });
  } catch (e) {
    console.error("ava-agent-config-preview", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
