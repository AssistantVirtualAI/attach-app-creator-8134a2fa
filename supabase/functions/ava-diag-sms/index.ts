// TEMP diagnostic — mint AVA session and call ava-tool-executor for send_sms path.
import { signAvaSession } from "../_shared/ava-session.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const userId = body?.user_id ?? "e5d025c9-eef2-4422-b97d-3190388b7376";
  const to = body?.to ?? "+15145551234";
  const message = body?.message ?? "Test AVA diag";
  const dryRun = body?.dry_run ?? true;

  const token = await signAvaSession(userId, 600);
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ava-tool-executor`;
  const headers = {
    Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    "Content-Type": "application/json",
    "X-Ava-Tool-Name": dryRun ? "get_integration_status" : "send_sms",
    "X-Ava-Session": token,
  };
  const payload = dryRun ? {} : { to, message };
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const txt = await r.text();
  return new Response(JSON.stringify({ status: r.status, body: txt }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
