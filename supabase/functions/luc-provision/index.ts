import { admin, corsHeaders, encryptSecret, hasRole, isUuid, json, requireUser, str } from "../_shared/luc.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const db = admin();
  const action = String(b?.action ?? "");

  if (action === "bootstrap") {
    // First signed-in user becomes platform admin, only while none exists.
    const { count } = await db.from("luc_memberships").select("id", { count: "exact", head: true }).eq("role", "platform_admin");
    if ((count ?? 0) > 0) return json({ error: "already_bootstrapped" }, 409);
    await db.from("luc_memberships").insert({ user_id: user.id, tenant_id: null, role: "platform_admin", email: user.email });
    return json({ ok: true });
  }

  if (action === "create_tenant") {
    if (!(await hasRole(db, user.id, null, []))) return json({ error: "forbidden" }, 403);
    const name = str(b.name, 120); const slug = str(b.slug, 60)?.toLowerCase();
    if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) return json({ error: "invalid_name_or_slug" }, 400);
    const { data, error } = await db.from("luc_tenants").insert({ name, slug }).select("id,name,slug").single();
    if (error) return json({ error: error.code === "23505" ? "slug_taken" : "create_failed" }, 400);
    await db.from("luc_memberships").insert({ user_id: user.id, tenant_id: data.id, role: "tenant_admin", email: user.email });
    return json({ ok: true, tenant: data });
  }

  const tenantId = b?.tenant_id;
  if (!isUuid(tenantId)) return json({ error: "tenant_id_required" }, 400);
  if (!(await hasRole(db, user.id, tenantId, ["tenant_admin"]))) return json({ error: "forbidden" }, 403);

  if (action === "create_pbx_connection") {
    const name = str(b.name, 120); const domain = str(b.pbx_domain, 200);
    if (!name || !domain) return json({ error: "invalid_input" }, 400);
    const secret = str(b.api_credential, 500);
    const { data, error } = await db.from("luc_pbx_connections").insert({
      tenant_id: tenantId, name, pbx_domain: domain, mode: "mock",
      credential_ciphertext: secret ? await encryptSecret(secret) : null,
    }).select("id,name,pbx_domain,mode,health").single();
    if (error) return json({ error: "create_failed" }, 400);
    return json({ ok: true, connection: data });
  }

  if (action === "provision_user") {
    const email = str(b.email, 200)?.toLowerCase(); const ext = str(b.extension, 20);
    const role = ["end_user", "tenant_support", "tenant_admin"].includes(b.role) ? b.role : "end_user";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ext || !/^\d{2,8}$/.test(ext)) return json({ error: "invalid_email_or_extension" }, 400);
    const { data: job } = await db.from("luc_provisioning_jobs").insert({ tenant_id: tenantId, kind: "provision_user", status: "running", detail: { extension: ext }, created_by: user.id }).select("id").single();
    let uid: string | null = null;
    const invited = await db.auth.admin.inviteUserByEmail(email);
    if (invited.data?.user) uid = invited.data.user.id;
    else {
      for (let page = 1; page <= 10 && !uid; page++) {
        const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
        uid = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
        if (!data || data.users.length < 200) break;
      }
    }
    if (!uid) {
      await db.from("luc_provisioning_jobs").update({ status: "failed", detail: { extension: ext, reason: "user_create_failed" } }).eq("id", job?.id);
      return json({ error: "user_create_failed" }, 400);
    }
    await db.from("luc_memberships").upsert({ user_id: uid, tenant_id: tenantId, role, email, display_name: str(b.display_name, 120) }, { onConflict: "user_id,tenant_id,role" });
    const sip = str(b.sip_password, 200);
    const { error: mapErr } = await db.from("luc_extension_mappings").insert({
      tenant_id: tenantId, user_id: uid, extension: ext, status: "active",
      pbx_connection_id: isUuid(b.pbx_connection_id) ? b.pbx_connection_id : null,
      sip_credential_ciphertext: sip ? await encryptSecret(sip) : null,
    });
    if (mapErr) {
      await db.from("luc_provisioning_jobs").update({ status: "failed", detail: { extension: ext, reason: mapErr.code === "23505" ? "extension_taken" : "mapping_failed" } }).eq("id", job?.id);
      return json({ error: mapErr.code === "23505" ? "extension_taken" : "mapping_failed" }, 400);
    }
    await db.from("luc_provisioning_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job?.id);
    return json({ ok: true, user_id: uid });
  }

  if (action === "simulate_events") {
    const target = isUuid(b.user_id) ? b.user_id : user.id;
    const { data: m } = await db.from("luc_memberships").select("id").eq("user_id", target).eq("tenant_id", tenantId).limit(1);
    if (!m?.length) return json({ error: "user_not_in_tenant" }, 400);
    const n = () => `+1514555${String(Math.floor(1000 + Math.random() * 8999))}`;
    const { data: call } = await db.from("luc_call_events").insert([
      { tenant_id: tenantId, user_id: target, direction: "inbound", remote_number: n(), status: "answered", duration_seconds: 94 },
      { tenant_id: tenantId, user_id: target, direction: "outbound", remote_number: n(), status: "answered", duration_seconds: 212 },
      { tenant_id: tenantId, user_id: target, direction: "inbound", remote_number: n(), status: "missed", duration_seconds: 0 },
    ]).select("id");
    await db.from("luc_voicemails").insert({ tenant_id: tenantId, user_id: target, caller: n(), duration_seconds: 31, transcription_status: "pending" });
    if (call?.[0]) await db.from("luc_recordings").insert({ tenant_id: tenantId, user_id: target, call_event_id: call[0].id, policy_allows_playback: false, ai_status: "not_consented" });
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
