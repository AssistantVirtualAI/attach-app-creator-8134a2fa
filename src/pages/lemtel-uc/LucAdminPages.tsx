import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLuc } from "@/components/lemtel-uc/LucContext";
import { useLucList } from "@/components/lemtel-uc/useLucQuery";
import { fmtDate, lucApi, type LucRole } from "@/components/lemtel-uc/api";
import { Badge, Empty, ErrorNote, PageTitle, Panel, Skeleton } from "@/components/lemtel-uc/ui";

const db = supabase as any;

export function LucTenantAdmin() {
  const { tenantId, isTenantAdmin } = useLuc(); const qc = useQueryClient();
  const members = useLucList("luc_memberships", "id,user_id,role,email,display_name,created_at");
  const exts = useLucList("luc_extension_mappings", "id,user_id,extension,status,created_at");
  const devices = useLucList("luc_devices", "id,user_id,label,platform,credential_status,created_at");
  const pbx = useLucList("luc_pbx_connections", "id,name,pbx_domain,mode,health,last_checked_at,created_at");
  const jobs = useLucList("luc_provisioning_jobs", "id,kind,status,detail,created_at");
  const audit = useLucList("luc_audit_events", "id,action,entity,entity_id,created_at");
  const flags = useLucList("luc_feature_flags", "id,key,enabled,created_at");
  const [u, setU] = useState({ email: "", extension: "", role: "end_user" as LucRole, display_name: "", pbx_connection_id: "" });
  const [p, setP] = useState({ name: "", pbx_domain: "", api_credential: "" });
  const [flag, setFlag] = useState("");
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); await qc.invalidateQueries({ queryKey: ["luc"] }); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (!isTenantAdmin) return <Empty>Administrator access required.</Empty>;
  const emailOf = (id: string) => members.data?.find((m: any) => m.user_id === id)?.email ?? id.slice(0, 8);
  return (
    <div className="space-y-4">
      <PageTitle title="Organization admin" sub="Users, extensions, devices, phone-system connection and audit trail." />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Invite user + map extension">
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => lucApi.provisionUser({ tenant_id: tenantId!, ...u, pbx_connection_id: u.pbx_connection_id || undefined })).then(() => setU({ ...u, email: "", extension: "", display_name: "" })); }}>
            <input className="luc-input" type="email" placeholder="Email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} required />
            <input className="luc-input" placeholder="Display name" value={u.display_name} onChange={(e) => setU({ ...u, display_name: e.target.value })} maxLength={120} />
            <div className="grid grid-cols-2 gap-2">
              <input className="luc-input" placeholder="Extension (e.g. 1001)" value={u.extension} onChange={(e) => setU({ ...u, extension: e.target.value.replace(/\D/g, "") })} required maxLength={8} />
              <select className="luc-input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as LucRole })}><option value="end_user">End user</option><option value="tenant_support">Support</option><option value="tenant_admin">Admin</option></select>
            </div>
            <select className="luc-input" value={u.pbx_connection_id} onChange={(e) => setU({ ...u, pbx_connection_id: e.target.value })}><option value="">No phone-system connection</option>{(pbx.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="luc-btn-primary" disabled={busy}>Invite</button>
          </form>
        </Panel>
        <Panel title="Phone-system connection (FusionPBX)">
          <form className="mb-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => lucApi.createPbx(tenantId!, p.name, p.pbx_domain, p.api_credential || undefined)).then(() => setP({ name: "", pbx_domain: "", api_credential: "" })); }}>
            <div className="grid grid-cols-2 gap-2">
              <input className="luc-input" placeholder="Name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} required />
              <input className="luc-input" placeholder="PBX domain" value={p.pbx_domain} onChange={(e) => setP({ ...p, pbx_domain: e.target.value })} required />
            </div>
            <input className="luc-input" type="password" autoComplete="off" placeholder="Integration credential (stored encrypted, optional)" value={p.api_credential} onChange={(e) => setP({ ...p, api_credential: e.target.value })} />
            <button className="luc-btn" disabled={busy}>Add connection</button>
          </form>
          {pbx.isLoading ? <Skeleton rows={1} /> : !pbx.data?.length ? <Empty>No connection yet.</Empty> : pbx.data.map((c: any) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm" style={{ borderColor: "hsl(var(--luc-border))" }}>
              <div>{c.name} <span className="luc-muted">· {c.pbx_domain}</span> <Badge tone={c.health.startsWith("healthy") ? "ok" : "warn"}>{c.health}</Badge> <Badge>{c.mode}</Badge></div>
              <div className="space-x-2"><button className="luc-btn" onClick={() => run(() => lucApi.pbx(tenantId!, c.id, "validate"))}>Check</button><button className="luc-btn" onClick={() => run(() => lucApi.pbx(tenantId!, c.id, "sync_extensions"))}>Sync</button></div>
            </div>))}
        </Panel>
      </div>
      <Panel title="Users & extensions">{members.isLoading ? <Skeleton /> : (
        <div className="overflow-x-auto"><table className="luc-table"><thead><tr><th>User</th><th>Role</th><th>Extension</th><th></th></tr></thead>
          <tbody>{(members.data ?? []).map((m: any) => {
            const x = exts.data?.find((e: any) => e.user_id === m.user_id);
            return <tr key={m.id}><td>{m.display_name || m.email}</td><td><Badge>{m.role.replace("_", " ")}</Badge></td><td className="font-mono">{x?.extension ?? "—"}</td>
              <td><button className="luc-btn" onClick={() => run(() => lucApi.simulate(tenantId!, m.user_id))}>Send test events</button></td></tr>;
          })}</tbody></table></div>)}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Devices">{!devices.data?.length ? <Empty>No devices.</Empty> : (
          <table className="luc-table"><tbody>{devices.data.map((d: any) => <tr key={d.id}><td>{d.label}</td><td className="luc-muted">{emailOf(d.user_id)}</td><td><Badge tone={d.credential_status === "issued" ? "ok" : "bad"}>{d.credential_status}</Badge></td>
            <td><button className="luc-btn" onClick={() => run(() => lucApi.deviceAction(tenantId!, d.id, "revoke"))}>Revoke</button></td></tr>)}</tbody></table>)}
        </Panel>
        <Panel title="Features">
          <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { const { error } = await db.from("luc_feature_flags").insert({ tenant_id: tenantId, key: flag.trim(), enabled: true }); if (error) throw error; }).then(() => setFlag("")); }}>
            <input className="luc-input" placeholder="feature key" value={flag} onChange={(e) => setFlag(e.target.value.replace(/[^a-z0-9_.-]/gi, ""))} required maxLength={60} /><button className="luc-btn">Add</button>
          </form>
          {(flags.data ?? []).map((f: any) => <label key={f.id} className="flex items-center justify-between py-1 text-sm">{f.key}
            <input type="checkbox" checked={f.enabled} onChange={() => run(async () => { const { error } = await db.from("luc_feature_flags").update({ enabled: !f.enabled }).eq("id", f.id); if (error) throw error; })} /></label>)}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Provisioning jobs">{!jobs.data?.length ? <Empty>No jobs.</Empty> : (
          <table className="luc-table"><tbody>{jobs.data.slice(0, 20).map((j: any) => <tr key={j.id}><td>{j.kind}</td><td><Badge tone={j.status === "done" ? "ok" : j.status === "failed" ? "bad" : "warn"}>{j.status}</Badge></td><td className="luc-muted text-xs">{fmtDate(j.created_at)}</td></tr>)}</tbody></table>)}
        </Panel>
        <Panel title="Audit log">{!audit.data?.length ? <Empty>No events.</Empty> : (
          <table className="luc-table"><tbody>{audit.data.slice(0, 30).map((a: any) => <tr key={a.id}><td>{a.action}</td><td>{a.entity.replace("luc_", "")}</td><td className="luc-muted text-xs">{fmtDate(a.created_at)}</td></tr>)}</tbody></table>)}
        </Panel>
      </div>
    </div>
  );
}

export function LucPlatform() {
  const { isPlatformAdmin, refresh } = useLuc(); const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ["luc", "platform-tenants"], queryFn: lucApi.tenants, enabled: isPlatformAdmin });
  const [name, setName] = useState(""); const [slug, setSlug] = useState(""); const [err, setErr] = useState<unknown>(null);
  if (!isPlatformAdmin) return <Empty>Platform administrator access required.</Empty>;
  const run = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); await qc.invalidateQueries({ queryKey: ["luc"] }); await refresh(); } catch (e) { setErr(e); } };
  return (
    <div className="space-y-4">
      <PageTitle title="Platform" sub="Organization lifecycle. Live calling remains disabled until Lemtel Edge is deployed." />
      <Panel title="New organization">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => lucApi.createTenant(name, slug)).then(() => { setName(""); setSlug(""); }); }}>
          <input className="luc-input max-w-xs" placeholder="Name" value={name} onChange={(e) => { setName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} required />
          <input className="luc-input max-w-xs" placeholder="short-id" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <button className="luc-btn-primary">Create</button>
        </form><ErrorNote error={err} />
      </Panel>
      <Panel title="Organizations">{tenants.isLoading ? <Skeleton /> : !tenants.data?.length ? <Empty>None.</Empty> : (
        <table className="luc-table"><thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Seats</th><th></th></tr></thead>
          <tbody>{tenants.data.map((t) => <tr key={t.id}><td>{t.name}</td><td className="font-mono">{t.slug}</td><td><Badge tone={t.status === "active" ? "ok" : "warn"}>{t.status}</Badge></td><td>{t.seat_limit}</td>
            <td><button className="luc-btn" onClick={() => run(async () => { const { error } = await db.from("luc_tenants").update({ status: t.status === "active" ? "suspended" : "active" }).eq("id", t.id); if (error) throw error; })}>{t.status === "active" ? "Suspend" : "Activate"}</button></td></tr>)}</tbody></table>)}
      </Panel>
      <Panel title="System health">
        <ul className="space-y-1 text-sm"><li>Control plane: <Badge tone="ok">online</Badge></li><li>Lemtel Edge SIP proxy: <Badge tone="warn">not deployed</Badge></li><li>FusionPBX adapter: <Badge tone="warn">mock</Badge></li><li>Push (APNS/FCM): <Badge tone="warn">mock</Badge></li></ul>
      </Panel>
    </div>
  );
}
