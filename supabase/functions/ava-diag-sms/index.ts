// TEMP diagnostic — mint AVA session and call ava-tool-executor, or run admin sync.
import { signAvaSession } from "../_shared/ava-session.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode ?? "tool";
  const userId = body?.user_id ?? "e5d025c9-eef2-4422-b97d-3190388b7376";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (mode === "sync") {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-manage-agent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_all_tools", _user_id: userId }),
    });
    return new Response(JSON.stringify({ status: r.status, body: await r.text() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (mode === "list_tools") {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-manage-agent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_tools", _user_id: userId }),
    });
    return new Response(JSON.stringify({ status: r.status, body: await r.text() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const to = body?.to ?? "+15145551234";
  const message = body?.message ?? "Test AVA diag";
  const toolName = body?.tool_name ?? "send_sms";
  const token = await signAvaSession(userId, 600);
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ava-tool-executor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      "Content-Type": "application/json",
      "X-Ava-Tool-Name": toolName,
      "X-Ava-Session": token,
    },
    body: JSON.stringify(toolName === "send_sms" ? { to, message } : {}),
  });
  return new Response(JSON.stringify({ status: r.status, body: await r.text() }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

