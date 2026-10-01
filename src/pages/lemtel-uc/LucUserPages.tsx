import { useState } from "react";
import { Mic, MicOff, Pause, PhoneOff, Star, Volume2 } from "lucide-react";
import { useLuc } from "@/components/lemtel-uc/LucContext";
import { useLucList } from "@/components/lemtel-uc/useLucQuery";
import { fmtDate, fmtDur, READ_ONLY } from "@/components/lemtel-uc/api";
import { Badge, Empty, PageTitle, Panel, Skeleton } from "@/components/lemtel-uc/ui";

const LIVE_OFF = "Live calling is not enabled yet: it needs the Lemtel Edge server and approved FusionPBX settings.";

function useMe() { return useLuc().session!.user.id; }

export function LucDashboard() {
  const uid = useMe();
  const ext = useLucList("luc_extension_mappings", "id,extension,status,user_id", "created_at", (q) => q.eq("user_id", uid));
  const devices = useLucList("luc_devices", "id,label,credential_status", "created_at", (q) => q.eq("user_id", uid));
  const calls = useLucList("luc_call_events", "*", "started_at", (q) => q.eq("user_id", uid).limit(5));
  const vms = useLucList("luc_voicemails", "id,read", "created_at", (q) => q.eq("user_id", uid));
  const issued = (devices.data ?? []).some((d: any) => d.credential_status === "issued");
  return (
    <div className="space-y-4">
      <PageTitle title="Dashboard" sub={LIVE_OFF} />
      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Extension">{ext.isLoading ? <Skeleton rows={1} /> : <div className="text-2xl font-bold">{ext.data?.[0]?.extension ?? "—"}</div>}</Panel>
        <Panel title="Connection"><Badge tone={issued ? "ok" : "warn"}>{issued ? "Device credential issued" : "No active device"}</Badge></Panel>
        <Panel title="Voicemail"><div className="text-2xl font-bold">{(vms.data ?? []).filter((v: any) => !v.read).length}</div><span className="luc-muted text-xs">unread</span></Panel>
        <Panel title="Preview"><p className="luc-muted text-xs">{READ_ONLY}</p></Panel>
      </div>
      <Panel title="Recent calls"><CallTable rows={calls.data} loading={calls.isLoading} /></Panel>
    </div>
  );
}

function CallTable({ rows, loading }: { rows?: any[]; loading: boolean }) {
  if (loading) return <Skeleton />;
  if (!rows?.length) return <Empty>No calls yet.</Empty>;
  return (
    <div className="overflow-x-auto"><table className="luc-table">
      <thead><tr><th>When</th><th>Direction</th><th>Number</th><th>Status</th><th>Duration</th></tr></thead>
      <tbody>{rows.map((c) => (
        <tr key={c.id}><td>{fmtDate(c.started_at)}</td><td>{c.direction}</td><td className="font-mono">{c.remote_number}</td>
          <td><Badge tone={c.status === "missed" ? "bad" : "ok"}>{c.status}</Badge></td><td>{fmtDur(c.duration_seconds)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

export function LucCalls() {
  const uid = useMe();
  const [filter, setFilter] = useState("all");
  const [num, setNum] = useState("");
  const [muted, setMuted] = useState(false);
  const calls = useLucList("luc_call_events", "*", "started_at", (q) => { q = q.eq("user_id", uid); return filter === "all" ? q : filter === "missed" ? q.eq("status", "missed") : q.eq("direction", filter); }, [filter]);
  return (
    <div className="space-y-4">
      <PageTitle title="Calls" />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel title="Dialer">
          <input className="luc-input mb-3 text-center font-mono text-lg" value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d+*#]/g, ""))} aria-label="Number" />
          <div className="grid grid-cols-3 gap-2">{"123456789*0#".split("").map((k) => <button key={k} className="luc-key" onClick={() => setNum((n) => n + k)}>{k}</button>)}</div>
          <button className="luc-btn-primary mt-3 w-full" disabled title={LIVE_OFF}>Call</button>
          <div className="mt-3 flex justify-between luc-muted" aria-label="Call controls (available once live calling is enabled)">
            <button className="luc-btn" onClick={() => setMuted(!muted)} aria-pressed={muted}>{muted ? <MicOff size={16} /> : <Mic size={16} />}</button>
            <button className="luc-btn" disabled><Pause size={16} /></button>
            <button className="luc-btn" disabled><Volume2 size={16} /></button>
            <button className="luc-btn" disabled><PhoneOff size={16} /></button>
          </div>
          <p className="luc-muted mt-3 text-xs">{LIVE_OFF}</p>
        </Panel>
        <Panel title="History" action={
          <select className="luc-input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
            <option value="all">All</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="missed">Missed</option>
          </select>}>
          <CallTable rows={calls.data} loading={calls.isLoading} />
        </Panel>
      </div>
    </div>
  );
}

export function LucContacts() {
  const uid = useMe();
  const list = useLucList("luc_contacts", "*", "created_at", (q) => q.eq("owner_id", uid));
  const rows = [...(list.data ?? [])].sort((a: any, b: any) => Number(b.favorite) - Number(a.favorite));
  return (
    <div className="space-y-4">
      <PageTitle title="Contacts" sub="Non-production preview data. Favorites appear first." />
      <Panel title="Add contact"><p className="luc-muted text-xs">{READ_ONLY}</p></Panel>
      <Panel>{list.isLoading ? <Skeleton /> : !rows.length ? <Empty>No contacts.</Empty> : (
        <table className="luc-table"><thead><tr><th></th><th>Name</th><th>Number</th><th>Email</th></tr></thead>
          <tbody>{rows.map((c: any) => <tr key={c.id}>
            <td><Star size={16} aria-label={c.favorite ? "Favorite" : "Not favorite"} className={c.favorite ? "luc-ok" : "luc-muted"} fill={c.favorite ? "currentColor" : "none"} /></td>
            <td>{c.name}</td><td className="font-mono">{c.number ?? "—"}</td><td>{c.email ?? "—"}</td></tr>)}</tbody></table>)}
      </Panel>
    </div>
  );
}

export function LucMessages() {
  const uid = useMe();
  const convs = useLucList("luc_conversations", "id,title,kind,created_at");
  const [active, setActive] = useState<string | null>(null);
  const msgs = useLucList("luc_messages", "id,body,sender_id,created_at", "created_at", (q) => q.eq("conversation_id", active ?? "00000000-0000-0000-0000-000000000000"), [active]);
  return (
    <div className="space-y-4">
      <PageTitle title="Messages" sub="Non-production preview data." />
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Panel title="Conversations">
          {convs.isLoading ? <Skeleton /> : !convs.data?.length ? <Empty>No conversations.</Empty> :
            <ul className="space-y-1">{convs.data.map((c: any) => <li key={c.id}><button type="button" className={`luc-nav w-full ${active === c.id ? "luc-nav-active" : ""}`} onClick={() => setActive(c.id)}>{c.title ?? "Conversation"}</button></li>)}</ul>}
        </Panel>
        <Panel title="Thread">
          {!active ? <Empty>Pick a conversation.</Empty> : (
            <div className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto">
              {[...(msgs.data ?? [])].reverse().map((m: any) => (
                <div key={m.id} className={`flex ${m.sender_id === uid ? "justify-end" : "justify-start"}`}>
                  <div className="luc-panel max-w-[75%] !p-2 text-sm">{m.body}<div className="luc-muted text-[10px]">{fmtDate(m.created_at)}</div></div>
                </div>))}
              {!msgs.data?.length && <Empty>No messages.</Empty>}
            </div>)}
          <p className="luc-muted text-xs">{READ_ONLY}</p>
        </Panel>
      </div>
    </div>
  );
}

export function LucVoicemail() {
  const uid = useMe();
  const vms = useLucList("luc_voicemails", "*", "created_at", (q) => q.eq("user_id", uid));
  const recs = useLucList("luc_recordings", "*", "created_at", (q) => q.eq("user_id", uid));
  return (
    <div className="space-y-4">
      <PageTitle title="Voicemail & recordings" sub="Playback appears only when your organization's policy allows it." />
      <Panel title="Voicemail">{vms.isLoading ? <Skeleton /> : !vms.data?.length ? <Empty>No voicemail.</Empty> : (
        <table className="luc-table"><thead><tr><th>When</th><th>Caller</th><th>Length</th><th>Transcription</th><th></th></tr></thead>
          <tbody>{vms.data.map((v: any) => <tr key={v.id}><td>{fmtDate(v.created_at)}</td><td className="font-mono">{v.caller}</td><td>{fmtDur(v.duration_seconds)}</td>
            <td><Badge tone={v.transcription_status === "done" ? "ok" : "neutral"}>{v.transcription_status}</Badge></td>
            <td>{v.read ? <span className="luc-muted text-xs">read</span> : <span className="text-xs">unread</span>}</td></tr>)}</tbody></table>)}
      </Panel>
      <Panel title="Recordings">{recs.isLoading ? <Skeleton /> : !recs.data?.length ? <Empty>No recordings available under current policy.</Empty> : (
        <table className="luc-table"><thead><tr><th>When</th><th>AI</th><th>Retention</th></tr></thead>
          <tbody>{recs.data.map((r: any) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td><Badge>{r.ai_status}</Badge></td><td>{fmtDate(r.retention_until)}</td></tr>)}</tbody></table>)}
      </Panel>
    </div>
  );
}

export function LucSettings() {
  const { session } = useLuc(); const uid = useMe();
  const devices = useLucList("luc_devices", "*", "created_at", (q) => q.eq("user_id", uid));
  return (
    <div className="space-y-4">
      <PageTitle title="Settings" />
      <Panel title="Profile"><p className="text-sm">{session?.user.email}</p></Panel>
      <Panel title="Devices (preview data)">
        <p className="luc-muted mb-2 text-xs">{READ_ONLY}</p>
        {devices.isLoading ? <Skeleton /> : !devices.data?.length ? <Empty>No devices.</Empty> : (
          <table className="luc-table"><thead><tr><th>Device</th><th>Proxy credential</th><th>Expires</th></tr></thead>
            <tbody>{devices.data.map((d: any) => <tr key={d.id}><td>{d.label} <span className="luc-muted text-xs">({d.platform})</span></td>
              <td><Badge tone={d.credential_status === "issued" ? "ok" : "bad"}>{d.credential_status}</Badge></td><td>{fmtDate(d.credential_expires_at)}</td></tr>)}</tbody></table>)}
      </Panel>
      <Panel title="Call features"><p className="luc-muted text-sm">Not available in this read-only preview.</p></Panel>
    </div>
  );
}
