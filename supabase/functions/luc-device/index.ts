import { admin, corsHeaders, hasRole, isUuid, json, requireUser, str } from "../_shared/luc.ts";

// Issues/revokes short-lived, device-bound proxy credential STATUS.
// The credential itself is delivered to Lemtel Edge only — never to the app.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const db = admin();
  const tenantId = b?.tenant_id;
  if (!isUuid(tenantId)) return json({ error: "tenant_id_required" }, 400);
  const { data: mem } = await db.from("luc_memberships").select("id").eq("user_id", user.id).eq("tenant_id", tenantId).limit(1);
  if (!mem?.length && !(await hasRole(db, user.id, null, []))) return json({ error: "forbidden" }, 403);
  const expires = () => new Date(Date.now() + 12 * 3600_000).toISOString();

  if (b.action === "enroll") {
    const label = str(b.label, 80); const platform = ["ios", "android", "desktop", "web"].includes(b.platform) ? b.platform : "web";
    if (!label) return json({ error: "label_required" }, 400);
    const { data, error } = await db.from("luc_devices").insert({ tenant_id: tenantId, user_id: user.id, label, platform, credential_status: "issued", credential_expires_at: expires(), last_seen_at: new Date().toISOString() }).select("id,label,platform,credential_status,credential_expires_at").single();
    if (error) return json({ error: "enroll_failed" }, 400);
    return json({ ok: true, device: data });
  }

  if (b.action === "revoke" || b.action === "renew") {
    if (!isUuid(b.device_id)) return json({ error: "device_id_required" }, 400);
    const { data: dev } = await db.from("luc_devices").select("id,user_id,tenant_id").eq("id", b.device_id).maybeSingle();
    if (!dev || dev.tenant_id !== tenantId) return json({ error: "not_found" }, 404);
    if (dev.user_id !== user.id && !(await hasRole(db, user.id, tenantId, ["tenant_admin", "tenant_support"]))) return json({ error: "forbidden" }, 403);
    const patch = b.action === "revoke"
      ? { credential_status: "revoked", revoked_at: new Date().toISOString(), credential_expires_at: null }
      : { credential_status: "issued", credential_expires_at: expires(), revoked_at: null };
    await db.from("luc_devices").update(patch).eq("id", dev.id);
    return json({ ok: true });
  }
  return json({ error: "unknown_action" }, 400);
});
