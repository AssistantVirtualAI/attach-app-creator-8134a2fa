// AVA Planiprêt — dynamic ElevenLabs agent config per broker.
// Builds the system prompt with the broker's actual context (NS extension,
// Maestro/M365 status, autonomy mode) and returns the tool catalog.
import { authBroker, corsHeaders, jsonResponse } from "../_shared/ns-broker.ts";
import { EXPECTED_TOOL_NAMES } from "../_shared/ava-tools.ts";
import { AVA_PROMPT_VERSION, buildAvaFirstMessage, buildAvaPrompt } from "../_shared/ava-prompt.ts";

const DEFAULT_AGENT_ID = Deno.env.get("ELEVENLABS_DEFAULT_AGENT_ID") ?? "";
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica — voix unique pour tous les courtiers

const TOOL_NAMES = EXPECTED_TOOL_NAMES;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await authBroker(req);
  if ("error" in auth) return auth.error;
  const { admin, profile } = auth;

  let reqBody: any = {};
  try { reqBody = req.method === "POST" ? await req.json() : {}; } catch { reqBody = {}; }
  const requestedLang: "fr" | "en" | null =
    reqBody?.language === "en" ? "en" : reqBody?.language === "fr" ? "fr" : null;

  const { data: full } = await admin
    .from("planipret_profiles")
    .select("id, full_name, extension, ns_domain, ms365_access_token, maestro_broker_id, maestro_connected, voice_agent_enabled, ava_autonomy_mode, ava_preferred_lang, elevenlabs_agent_id, ava_voice_id, ava_voice_name, ava_voice_stability, ava_voice_similarity, ava_voice_style, ava_voice_speed")
    .eq("id", profile.id)
    .maybeSingle();

  const p: any = full ?? profile;
  if (p.voice_agent_enabled === false) {
    return jsonResponse({ success: false, error: "ava_not_enabled_for_user" }, 403);
  }

  // Agent partagé : TOUS les courtiers utilisent le même agent ConvAI.
  // La personnalisation se fait par variables dynamiques (prénom, courriel).
  const agentId = DEFAULT_AGENT_ID || p.elevenlabs_agent_id;
  if (!agentId) {
    return jsonResponse({
      success: false,
      error: "ELEVENLABS_DEFAULT_AGENT_ID not configured",
      setup_required: true,
      setup_url: "/planipret/admin/integrations",
      missing_secret: "ELEVENLABS_DEFAULT_AGENT_ID",
    }, 200);
  }

  const lang: "fr" | "en" = requestedLang ?? (p.ava_preferred_lang === "en" ? "en" : "fr");
  // Persist the active UI language so voice + chat + brief stay in sync.
  if (requestedLang && requestedLang !== p.ava_preferred_lang) {
    admin.from("planipret_profiles").update({ ava_preferred_lang: requestedLang })
      .eq("id", p.id).then(() => null);
  }

  // Voix partagée : une seule voix pour tout le monde.
  const voiceId = DEFAULT_VOICE_ID;

  // Probe ElevenLabs to detect which overrides the agent allows.
  // Sending disallowed overrides closes the WS right after connect.
  const overrides_allowed = { prompt: false, first_message: false, language: false, voice: false };
  let agent_status: string | null = null;
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  if (ELEVENLABS_API_KEY) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`, {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      });
      if (r.ok) {
        const agent = await r.json();
        agent_status = "ok";
        const ov = agent?.platform_settings?.overrides?.conversation_config_override ?? {};
        overrides_allowed.prompt = !!ov?.agent?.prompt?.prompt;
        overrides_allowed.first_message = !!ov?.agent?.first_message;
        overrides_allowed.language = !!ov?.agent?.language;
        overrides_allowed.voice = !!ov?.tts?.voice_id;

        // Shared-agent settings are admin-owned. A regular broker may inspect
        // the supported overrides but must never PATCH the shared agent.
        if (!overrides_allowed.first_message || !overrides_allowed.prompt || !overrides_allowed.language || !overrides_allowed.voice) {
          agent_status = "overrides_incomplete_admin_sync_required";
        }
      } else {
        agent_status = `error_${r.status}`;
      }
    } catch (e) {
      console.warn("ava-agent-config overrides probe failed", e);
      agent_status = "probe_failed";
    }
  }

  return jsonResponse({
    success: true,
    agent_id: agentId,
    voice_agent_enabled: true,
    system_prompt: buildAvaPrompt(p, lang),
    prompt_version: AVA_PROMPT_VERSION,
    first_message: buildAvaFirstMessage(p.full_name, lang),
    voice_id: voiceId,
    voice_settings: {
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0.3,
      speed: 1,
    },
    voice_name: null,
    language: lang,
    autonomy_mode: "confirm",
    overrides_allowed,
    agent_status,
    tools: TOOL_NAMES,
  });
});
