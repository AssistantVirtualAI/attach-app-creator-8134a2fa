// Temporary diagnostics: inspect the shared ConvAI agent + last conversations.
// Guarded by PP_OPS_KEY.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const AGENT = Deno.env.get("ELEVENLABS_DEFAULT_AGENT_ID") ?? "";
const OPS = Deno.env.get("PP_OPS_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  if (!OPS || url.searchParams.get("ops") !== OPS) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const h = { "xi-api-key": KEY };
  const out: Record<string, unknown> = { agent_id: AGENT, key_len: KEY.length };

  const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT}`, { headers: h });
  const agentTxt = await agentRes.text();
  out.agent_status = agentRes.status;
  try {
    const a = JSON.parse(agentTxt);
    out.agent = {
      name: a?.name,
      overrides: a?.platform_settings?.overrides,
      llm: a?.conversation_config?.agent?.prompt?.llm,
      voice_id: a?.conversation_config?.tts?.voice_id,
      model_id: a?.conversation_config?.tts?.model_id,
      dynamic_vars: a?.conversation_config?.agent?.dynamic_variables,
      tools: (a?.conversation_config?.agent?.prompt?.tools ?? []).map((t: any) => t?.name),
    };
  } catch { out.agent_body = agentTxt.slice(0, 800); }

  const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${AGENT}&page_size=5`, { headers: h });
  const convTxt = await convRes.text();
  out.conv_status = convRes.status;
  let ids: string[] = [];
  try {
    const c = JSON.parse(convTxt);
    ids = (c?.conversations ?? []).map((x: any) => x.conversation_id);
    out.conversations = (c?.conversations ?? []).map((x: any) => ({
      id: x.conversation_id, status: x.status, start: x.start_time_unix_secs, secs: x.call_duration_secs,
    }));
  } catch { out.conv_body = convTxt.slice(0, 800); }

  if (ids[0]) {
    const dRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${ids[0]}`, { headers: h });
    const dTxt = await dRes.text();
    try {
      const d = JSON.parse(dTxt);
      out.last_conversation = {
        status: d?.status,
        termination_reason: d?.metadata?.termination_reason,
        error: d?.metadata?.error,
        transcript_len: (d?.transcript ?? []).length,
      };
    } catch { out.last_conv_body = dTxt.slice(0, 800); }
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
