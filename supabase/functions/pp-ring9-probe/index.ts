import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({ ok: true, marker: "pp-build-2026-08-02-ring9" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
