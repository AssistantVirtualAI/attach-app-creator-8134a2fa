// Scheduled (1 min) Marc-only AVA SMS watcher. Server-only: cron secret or service key.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { runAvaSmsWatch } from "../_shared/ava-sms-watch.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cron = Deno.env.get("PP_NS_SYNC_CRON_SECRET") ?? "";
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  if (!((key && bearer === key) || (cron && cronHeader === cron))) return json({ error: "unauthorized" }, 401);
  try {
    const result = await runAvaSmsWatch(createClient(Deno.env.get("SUPABASE_URL")!, key));
    if ((result as any).inbound) console.log("[ava-sms-watch]", JSON.stringify(result));
    return json({ success: true, ...result });
  } catch (e) {
    console.error("[ava-sms-watch] failed", e instanceof Error ? e.message : "error");
    return json({ error: "watch_failed" }, 502);
  }
});
