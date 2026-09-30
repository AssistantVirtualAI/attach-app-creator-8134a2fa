import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Pause, PhoneOff, Star, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLuc } from "@/components/lemtel-uc/LucContext";
import { useLucList } from "@/components/lemtel-uc/useLucQuery";
import { fmtDate, fmtDur, lucApi } from "@/components/lemtel-uc/api";
import { Badge, Empty, ErrorNote, PageTitle, Panel, Skeleton } from "@/components/lemtel-uc/ui";

const db = supabase as any;
const LIVE_OFF = "Live calling is not enabled yet: it needs the Lemtel Edge server and approved FusionPBX settings.";

function useMe() { return useLuc().session!.user.id; }

export function LucDashboard() {
  const uid = useMe();
  const { tenantId } = useLuc();
  const qc = useQueryClient();
  const ext = useLucList("luc_extension_mappings", "id,extension,status,user_id", "created_at", (q) => q.eq("user_id", uid));
  const devices = useLucList("luc_devices", "id,label,credential_status", "created_at", (q) => q.eq("user_id", uid));
  const calls = useLucList("luc_call_events", "*", "started_at", (q) => q.eq("user_id", uid).limit(5));
  const vms = useLucList("luc_voicemails", "id,read", "created_at", (q) => q.eq("user_id", uid));
  const [err, setErr] = useState<unknown>(null);
  const issued = (devices.data ?? []).some((d: any) => d.credential_status === "issued");
  return (
    <div className="space-y-4">
      <PageTitle title="Dashboard" sub={LIVE_OFF} />
      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Extension">{ext.isLoading ? <Skeleton rows={1} /> : <div className="text-2xl font-bold">{ext.data?.[0]?.extension ?? "—"}</div>}</Panel>
        <Panel title="Connection"><Badge tone={issued ? "ok" : "warn"}>{issued ? "Device credential issued" : "No active device"}</Badge></Panel>
        <Panel title="Voicemail"><div className="text-2xl font-bold">{(vms.data ?? []).filter((v: any) => !v.read).length}</div><span className="luc-muted text-xs">unread</span></Panel>
        <Panel title="Quick actions">
          <button className="luc-btn w-full" onClick={async () => { setErr(null); try { await lucApi.simulate(tenantId!); await qc.invalidateQueries({ queryKey: ["luc"] }); } catch (e) { setErr(e); } }}>Simulate call events</button>
          <ErrorNote error={err} />
        </Panel>
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
  const uid = useMe(); const { tenantId } = useLuc(); const qc = useQueryClient();
  const list = useLucList("luc_contacts", "*", "created_at", (q) => q.eq("owner_id", uid));
  const [f, setF] = useState({ name: "", number: "", email: "" }); const [err, setErr] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const { error } = await db.from("luc_contacts").insert({ tenant_id: tenantId, owner_id: uid, name: f.name.trim(), number: f.number || null, email: f.email || null });
    if (error) return setErr(error); setF({ name: "", number: "", email: "" }); qc.invalidateQueries({ queryKey: ["luc", "luc_contacts"] });
  };
  const toggle = async (c: any) => { await db.from("luc_contacts").update({ favorite: !c.favorite }).eq("id", c.id); qc.invalidateQueries({ queryKey: ["luc", "luc_contacts"] }); };
  const rows = [...(list.data ?? [])].sort((a: any, b: any) => Number(b.favorite) - Number(a.favorite));
  return (
    <div className="space-y-4">
      <PageTitle title="Contacts" sub="Favorites appear first." />
      <Panel title="Add contact">
        <form onSubmit={save} className="grid gap-2 md:grid-cols-4">
          <input className="luc-input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} />
          <input className="luc-input" placeholder="Number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} maxLength={30} />
          <input className="luc-input" placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <button className="luc-btn-primary">Add</button>
        </form><ErrorNote error={err} />
      </Panel>
      <Panel>{list.isLoading ? <Skeleton /> : !rows.length ? <Empty>No contacts yet.</Empty> : (
        <table className="luc-table"><thead><tr><th></th><th>Name</th><th>Number</th><th>Email</th></tr></thead>
          <tbody>{rows.map((c: any) => <tr key={c.id}>
            <td><button aria-label="Favorite" onClick={() => toggle(c)}><Star size={16} className={c.favorite ? "luc-ok" : "luc-muted"} fill={c.favorite ? "currentColor" : "none"} /></button></td>
            <td>{c.name}</td><td className="font-mono">{c.number ?? "—"}</td><td>{c.email ?? "—"}</td></tr>)}</tbody></table>)}
      </Panel>
    </div>
  );
}

export function LucMessages() {
  const uid = useMe(); const { tenantId } = useLuc(); const qc = useQueryClient();
  const convs = useLucList("luc_conversations", "id,title,kind,created_at");
  const [active, setActive] = useState<string | null>(null);
  const msgs = useLucList("luc_messages", "id,body,sender_id,created_at", "created_at", (q) => q.eq("conversation_id", active ?? "00000000-0000-0000-0000-000000000000"), [active]);
  const [text, setText] = useState(""); const [title, setTitle] = useState(""); const [err, setErr] = useState<unknown>(null);
  const create = async () => {
    setErr(null);
    const { data, error } = await db.from("luc_conversations").insert({ tenant_id: tenantId, title: title || "New conversation", kind: "group", created_by: uid }).select("id").single();
    if (error) return setErr(error);
    const { error: e2 } = await db.from("luc_conversation_members").insert({ conversation_id: data.id, user_id: uid });
    if (e2) return setErr(e2);
    setTitle(""); setActive(data.id); qc.invalidateQueries({ queryKey: ["luc", "luc_conversations"] });
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!text.trim() || !active) return;
    const { error } = await db.from("luc_messages").insert({ tenant_id: tenantId, conversation_id: active, sender_id: uid, body: text.trim().slice(0, 4000) });
    if (error) return setErr(error); setText(""); qc.invalidateQueries({ queryKey: ["luc", "luc_messages"] });
  };
  return (
    <div className="space-y-4">
      <PageTitle title="Messages" />
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Panel title="Conversations">
          <div className="mb-3 flex gap-2"><input className="luc-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /><button className="luc-btn" onClick={create}>New</button></div>
          {convs.isLoading ? <Skeleton /> : !convs.data?.length ? <Empty>No conversations.</Empty> :
            <ul className="space-y-1">{convs.data.map((c: any) => <li key={c.id}><button className={`luc-nav w-full ${active === c.id ? "luc-nav-active" : ""}`} onClick={() => setActive(c.id)}>{c.title ?? "Conversation"}</button></li>)}</ul>}
        </Panel>
        <Panel title="Thread">
          {!active ? <Empty>Pick a conversation.</Empty> : (
            <>
              <div className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto">
                {[...(msgs.data ?? [])].reverse().map((m: any) => (
                  <div key={m.id} className={`flex ${m.sender_id === uid ? "justify-end" : "justify-start"}`}>
                    <div className="luc-panel max-w-[75%] !p-2 text-sm">{m.body}<div className="luc-muted text-[10px]">{fmtDate(m.created_at)}</div></div>
                  </div>))}
                {!msgs.data?.length && <Empty>No messages yet.</Empty>}
              </div>
              <form onSubmit={send} className="flex gap-2"><input className="luc-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" /><button className="luc-btn-primary">Send</button></form>
            </>)}
          <ErrorNote error={err} />
        </Panel>
      </div>
    </div>
  );
}

export function LucVoicemail() {
  const uid = useMe(); const qc = useQueryClient();
  const vms = useLucList("luc_voicemails", "*", "created_at", (q) => q.eq("user_id", uid));
  const recs = useLucList("luc_recordings", "*", "created_at", (q) => q.eq("user_id", uid));
  const markRead = async (id: string) => { await db.from("luc_voicemails").update({ read: true }).eq("id", id); qc.invalidateQueries({ queryKey: ["luc", "luc_voicemails"] }); };
  return (
    <div className="space-y-4">
      <PageTitle title="Voicemail & recordings" sub="Playback appears only when your organization's policy allows it." />
      <Panel title="Voicemail">{vms.isLoading ? <Skeleton /> : !vms.data?.length ? <Empty>No voicemail.</Empty> : (
        <table className="luc-table"><thead><tr><th>When</th><th>Caller</th><th>Length</th><th>Transcription</th><th></th></tr></thead>
          <tbody>{vms.data.map((v: any) => <tr key={v.id}><td>{fmtDate(v.created_at)}</td><td className="font-mono">{v.caller}</td><td>{fmtDur(v.duration_seconds)}</td>
            <td><Badge tone={v.transcription_status === "done" ? "ok" : "neutral"}>{v.transcription_status}</Badge></td>
            <td>{v.read ? <span className="luc-muted text-xs">read</span> : <button className="luc-btn" onClick={() => markRead(v.id)}>Mark read</button>}</td></tr>)}</tbody></table>)}
      </Panel>
      <Panel title="Recordings">{recs.isLoading ? <Skeleton /> : !recs.data?.length ? <Empty>No recordings available under current policy.</Empty> : (
        <table className="luc-table"><thead><tr><th>When</th><th>AI</th><th>Retention</th></tr></thead>
          <tbody>{recs.data.map((r: any) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td><Badge>{r.ai_status}</Badge></td><td>{fmtDate(r.retention_until)}</td></tr>)}</tbody></table>)}
      </Panel>
    </div>
  );
}

export function LucSettings() {
  const { session, tenantId } = useLuc(); const uid = useMe(); const qc = useQueryClient();
  const devices = useLucList("luc_devices", "*", "created_at", (q) => q.eq("user_id", uid));
  const [label, setLabel] = useState(""); const [platform, setPlatform] = useState("web"); const [err, setErr] = useState<unknown>(null);
  const act = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); qc.invalidateQueries({ queryKey: ["luc", "luc_devices"] }); } catch (e) { setErr(e); } };
  return (
    <div className="space-y-4">
      <PageTitle title="Settings" />
      <Panel title="Profile"><p className="text-sm">{session?.user.email}</p></Panel>
      <Panel title="Devices">
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => lucApi.enrollDevice(tenantId!, label, platform)).then(() => setLabel("")); }}>
          <input className="luc-input max-w-xs" placeholder="Device name" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
          <select className="luc-input w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="web">Web</option><option value="desktop">Desktop</option><option value="ios">iOS</option><option value="android">Android</option></select>
          <button className="luc-btn-primary">Add device</button>
        </form>
        <ErrorNote error={err} />
        {devices.isLoading ? <Skeleton /> : !devices.data?.length ? <Empty>No devices.</Empty> : (
          <table className="luc-table"><thead><tr><th>Device</th><th>Proxy credential</th><th>Expires</th><th></th></tr></thead>
            <tbody>{devices.data.map((d: any) => <tr key={d.id}><td>{d.label} <span className="luc-muted text-xs">({d.platform})</span></td>
              <td><Badge tone={d.credential_status === "issued" ? "ok" : "bad"}>{d.credential_status}</Badge></td><td>{fmtDate(d.credential_expires_at)}</td>
              <td className="space-x-2 whitespace-nowrap"><button className="luc-btn" onClick={() => act(() => lucApi.deviceAction(tenantId!, d.id, "renew"))}>Renew</button>
                <button className="luc-btn" onClick={() => act(() => lucApi.deviceAction(tenantId!, d.id, "revoke"))}>Revoke</button></td></tr>)}</tbody></table>)}
        <p className="luc-muted mt-2 text-xs">The credential itself is held by the Lemtel Edge server and is never shown.</p>
      </Panel>
      <Panel title="Call features"><p className="luc-muted text-sm">Caller ID, forwarding and Do Not Disturb requests will be available once the FusionPBX connection is approved.</p></Panel>
    </div>
  );
}
