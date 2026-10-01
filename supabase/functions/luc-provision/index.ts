import { corsHeaders, json, requireUser } from "../_shared/luc.ts";

// Phase 0: read-only preview. Every provisioning action is disabled and has
// no side effect (no database write, no identity/invitation call).
const DISABLED = new Set(["bootstrap", "create_tenant", "create_pbx_connection", "provision_user", "simulate_events"]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (b?.sip_password !== undefined || b?.api_credential !== undefined) return json({ error: "credentials_not_accepted" }, 400);
  const action = String(b?.action ?? "");
  if (DISABLED.has(action)) return json({ error: "preview_read_only" }, 409);
  return json({ error: "unknown_action" }, 400);
});
