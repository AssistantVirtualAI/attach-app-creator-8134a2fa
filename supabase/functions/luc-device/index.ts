import { corsHeaders, json, requireUser } from "../_shared/luc.ts";

// Phase 0: read-only preview. Device enroll/renew/revoke are disabled before
// any database access; no credential status is ever issued here.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (["enroll", "renew", "revoke"].includes(String(b?.action))) return json({ error: "preview_read_only" }, 409);
  return json({ error: "unknown_action" }, 400);
});
