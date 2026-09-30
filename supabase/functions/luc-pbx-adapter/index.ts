import { admin, corsHeaders, hasRole, isUuid, json, requireUser } from "../_shared/luc.ts";

// FusionPBX adapter interface. Only a MOCK implementation is active; the real
// adapter needs the owner-approved integration method (never a UI scrape or
// client-side admin login).
interface PbxAdapter {
  validate(): Promise<{ ok: boolean; detail: string }>;
  syncExtensions(): Promise<{ count: number }>;
}
const mockAdapter: PbxAdapter = {
  validate: async () => ({ ok: true, detail: "mock_connection_ok" }),
  syncExtensions: async () => ({ count: 0 }),
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await requireUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!isUuid(b?.tenant_id) || !isUuid(b?.connection_id)) return json({ error: "invalid_input" }, 400);
  const db = admin();
  if (!(await hasRole(db, user.id, b.tenant_id, ["tenant_admin", "tenant_support"]))) return json({ error: "forbidden" }, 403);
  const { data: conn } = await db.from("luc_pbx_connections").select("id,tenant_id,mode").eq("id", b.connection_id).maybeSingle();
  if (!conn || conn.tenant_id !== b.tenant_id) return json({ error: "not_found" }, 404);
  const adapter = mockAdapter;
  if (b.action === "validate") {
    const r = await adapter.validate();
    await db.from("luc_pbx_connections").update({ health: r.ok ? "healthy_mock" : "error", last_checked_at: new Date().toISOString() }).eq("id", conn.id);
    return json({ ok: r.ok, detail: r.detail, mode: conn.mode });
  }
  if (b.action === "sync_extensions") {
    const r = await adapter.syncExtensions();
    await db.from("luc_provisioning_jobs").insert({ tenant_id: b.tenant_id, kind: "pbx_sync_extensions", status: "done", detail: { count: r.count, mode: "mock" }, created_by: user.id });
    return json({ ok: true, ...r });
  }
  return json({ error: "unknown_action" }, 400);
});
