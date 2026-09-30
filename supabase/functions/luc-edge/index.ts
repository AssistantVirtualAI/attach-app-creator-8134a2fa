import { admin, configError, corsHeaders, isUuid, json, verifyEdgeSignature } from "../_shared/luc.ts";

// Contract endpoint for the separate Lemtel Edge SIP proxy (Kamailio/OpenSIPS).
// Requests must carry x-luc-signature = hex(HMAC-SHA256(LUC_EDGE_SECRET, body)).
// Push delivery is mocked until APNS/FCM credentials exist.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  let ok = false;
  try { ok = await verifyEdgeSignature(Deno.env.get("LUC_EDGE_SECRET"), raw, req.headers.get("x-luc-signature")); }
  catch (e) { return configError(e) ?? json({ error: "internal_error" }, 500); }
  if (!ok) return json({ error: "invalid_signature" }, 401);
  let b: any;
  try { b = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  if (!isUuid(b?.tenant_id)) return json({ error: "tenant_id_required" }, 400);
  const db = admin();
  const kind = b.event === "invite_push" ? "edge_invite_push" : b.event === "registration_health" ? "edge_registration_health" : null;
  if (!kind) return json({ error: "unknown_event" }, 400);
  await db.from("luc_provisioning_jobs").insert({
    tenant_id: b.tenant_id, kind, status: "done",
    detail: { extension: String(b.extension ?? "").slice(0, 20), state: String(b.state ?? "").slice(0, 40), push: "mock" },
  });
  return json({ ok: true, push: kind === "edge_invite_push" ? "mock_delivered" : undefined });
});
