import { useQuery } from "@tanstack/react-query";
import { useLuc } from "@/components/lemtel-uc/LucContext";
import { useLucList } from "@/components/lemtel-uc/useLucQuery";
import { fmtDate, lucApi, READ_ONLY } from "@/components/lemtel-uc/api";
import { Badge, Empty, PageTitle, Panel, Skeleton } from "@/components/lemtel-uc/ui";

const RO = () => <p className="luc-muted text-xs">{READ_ONLY}</p>;

export function LucTenantAdmin() {
  const { isTenantAdmin } = useLuc();
  const members = useLucList("luc_memberships", "id,user_id,role,email,display_name,created_at");
  const exts = useLucList("luc_extension_mappings", "id,user_id,extension,status,created_at");
  const devices = useLucList("luc_devices", "id,user_id,label,platform,credential_status,created_at");
  const pbx = useLucList("luc_pbx_connections", "id,name,pbx_domain,mode,health,last_checked_at,created_at");
  const jobs = useLucList("luc_provisioning_jobs", "id,kind,status,detail,created_at");
  const audit = useLucList("luc_audit_events", "id,action,entity,entity_id,created_at");
  const flags = useLucList("luc_feature_flags", "id,key,enabled,created_at");
  if (!isTenantAdmin) return <Empty>Administrator access required.</Empty>;
  const emailOf = (id: string) => members.data?.find((m: any) => m.user_id === id)?.email ?? id.slice(0, 8);
  return (
    <div className="space-y-4">
      <PageTitle title="Organization admin" sub="Read-only view of non-production preview data." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Invite user + map extension"><RO /><button type="button" className="luc-btn-primary mt-2" disabled>Invite (disabled)</button></Panel>
        <Panel title="Phone-system connection (FusionPBX · not connected)">
          <RO />
          {pbx.isLoading ? <Skeleton rows={1} /> : !pbx.data?.length ? <Empty>No connection.</Empty> : pbx.data.map((c: any) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border-t py-2 text-sm" style={{ borderColor: "hsl(var(--luc-border))" }}>
              {c.name} <span className="luc-muted">· {c.pbx_domain}</span> <Badge tone={String(c.health).startsWith("healthy") ? "ok" : "warn"}>{c.health}</Badge> <Badge>{c.mode}</Badge>
            </div>))}
        </Panel>
      </div>
      <Panel title="Users & extensions">{members.isLoading ? <Skeleton /> : (
        <div className="overflow-x-auto"><table className="luc-table"><thead><tr><th>User</th><th>Role</th><th>Extension</th></tr></thead>
          <tbody>{(members.data ?? []).map((m: any) => {
            const x = exts.data?.find((e: any) => e.user_id === m.user_id);
            return <tr key={m.id}><td>{m.display_name || m.email}</td><td><Badge>{m.role.replace("_", " ")}</Badge></td><td className="font-mono">{x?.extension ?? "—"}</td></tr>;
          })}</tbody></table></div>)}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Devices">{!devices.data?.length ? <Empty>No devices.</Empty> : (
          <table className="luc-table"><tbody>{devices.data.map((d: any) => <tr key={d.id}><td>{d.label}</td><td className="luc-muted">{emailOf(d.user_id)}</td><td><Badge tone={d.credential_status === "issued" ? "ok" : "bad"}>{d.credential_status}</Badge></td></tr>)}</tbody></table>)}
        </Panel>
        <Panel title="Features">
          {!flags.data?.length ? <Empty>No features.</Empty> : flags.data.map((f: any) => <div key={f.id} className="flex items-center justify-between py-1 text-sm">{f.key}<Badge tone={f.enabled ? "ok" : "neutral"}>{f.enabled ? "on" : "off"}</Badge></div>)}
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
  const { isPlatformAdmin } = useLuc();
  const tenants = useQuery({ queryKey: ["luc", "platform-tenants"], queryFn: lucApi.tenants, enabled: isPlatformAdmin });
  if (!isPlatformAdmin) return <Empty>Platform administrator access required.</Empty>;
  return (
    <div className="space-y-4">
      <PageTitle title="Platform" sub="Read-only preview. Live calling remains disabled." />
      <Panel title="New organization"><RO /><button type="button" className="luc-btn-primary mt-2" disabled>Create (disabled)</button></Panel>
      <Panel title="Organizations (preview data)">{tenants.isLoading ? <Skeleton /> : !tenants.data?.length ? <Empty>None.</Empty> : (
        <table className="luc-table"><thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Seats</th></tr></thead>
          <tbody>{tenants.data.map((t) => <tr key={t.id}><td>{t.name}</td><td className="font-mono">{t.slug}</td><td><Badge tone={t.status === "active" ? "ok" : "warn"}>{t.status}</Badge></td><td>{t.seat_limit}</td></tr>)}</tbody></table>)}
      </Panel>
      <Panel title="System health">
        <ul className="space-y-1 text-sm"><li>Preview mode: <Badge tone="warn">read-only</Badge></li><li>Lemtel Edge SIP proxy: <Badge tone="warn">not deployed</Badge></li><li>FusionPBX adapter: <Badge tone="warn">disabled</Badge></li><li>Push (APNS/FCM): <Badge tone="warn">disabled</Badge></li></ul>
      </Panel>
    </div>
  );
}
