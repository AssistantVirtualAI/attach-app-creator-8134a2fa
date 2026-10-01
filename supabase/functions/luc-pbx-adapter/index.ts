import { corsHeaders, json, requireUser } from "../_shared/luc.ts";

// Phase 0: read-only preview. The FusionPBX adapter is disabled: validate and
// sync_extensions return before any health update or provisioning job.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (["validate", "sync_extensions"].includes(String(b?.action))) return json({ error: "preview_read_only" }, 409);
  return json({ error: "unknown_action" }, 400);
});
