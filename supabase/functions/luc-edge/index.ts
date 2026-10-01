import { configError, corsHeaders, json, verifyEdgeSignature } from "../_shared/luc.ts";

// Contract endpoint for the future Lemtel Edge SIP proxy.
// Requests must carry x-luc-signature = hex(HMAC-SHA256(LUC_EDGE_SECRET, body)).
// Phase 0: after signature validation the endpoint is disabled — no event or job is recorded.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  let ok = false;
  try { ok = await verifyEdgeSignature(Deno.env.get("LUC_EDGE_SECRET"), raw, req.headers.get("x-luc-signature")); }
  catch (e) { return configError(e) ?? json({ error: "internal_error" }, 500); }
  if (!ok) return json({ error: "invalid_signature" }, 401);
  return json({ error: "edge_not_enabled" }, 503);
});
