import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Hash, MessageSquare, Send, RefreshCw, Loader2, Plus, X, Search } from "lucide-react";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { fmtDateTime } from "@/lib/planipret/brokerFormat";

type Lang = "fr" | "en";
type Thread =
  | { kind: "chat"; id: string; title: string }
  | { kind: "channel"; teamId: string; channelId: string; title: string };

export default function TeamsPanel({ lang }: { lang: Lang }) {
  const en = lang === "en";
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [tab, setTab] = useState<"chats" | "people" | "teams">("chats");
  const [query, setQuery] = useState("");

  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTopic, setGroupTopic] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("ms365-teams-list", { body: {} });
    setLoading(false);
    const p = (data as any) ?? {};
    if (error && !p.chats) { setErr(error.message || "Erreur"); return; }
    if (p.connected === false || p.error) { setErr(p.error === "ms365_not_connected" ? "ms365_not_connected" : String(p.error || "")); return; }
    setChats(p.chats ?? []); setTeams(p.teams ?? []); setPeople(p.people ?? []);
  };
  useEffect(() => { void load(); }, []);

  const loadMessages = async (t: Thread) => {
    setMsgLoading(true);
    const body: any = t.kind === "chat"
      ? { action: "list", chat_id: t.id, top: 30 }
      : { action: "list", team_id: t.teamId, channel_id: t.channelId, top: 30 };
    const { data } = await supabase.functions.invoke("ms365-teams-messages", { body });
    setMessages(((data as any)?.messages ?? []).slice().reverse());
    setMsgLoading(false);
  };

  const openThread = (t: Thread) => { setActive(t); setMessages([]); void loadMessages(t); };

  const send = async () => {
    if (!active || !draft.trim()) return;
    setSending(true);
    const body: any = active.kind === "chat"
      ? { action: "send", chat_id: active.id, content: draft, contentType: "text" }
      : { action: "send", team_id: active.teamId, channel_id: active.channelId, content: draft, contentType: "text" };
    const { data, error } = await supabase.functions.invoke("ms365-teams-messages", { body });
    setSending(false);
    const p = (data as any) ?? {};
    if (error || p.error) { toast.error(p.error || error?.message || (en ? "Send failed" : "Envoi impossible")); return; }
    setDraft("");
    void loadMessages(active);
  };

  const createGroup = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("ms365-teams-messages", {
      body: { action: "create_chat", user_ids: ids, ...(groupTopic.trim() ? { topic: groupTopic.trim() } : {}) },
    });
    setCreating(false);
    const p = (data as any) ?? {};
    if (error || p.error || !p.chat_id) { toast.error(p.error || error?.message || (en ? "Could not create the chat" : "Impossible de créer la conversation")); return; }
    toast.success(en ? "Conversation created" : "Conversation créée");
    setGroupOpen(false); setSelected(new Set()); setGroupTopic("");
    openThread({ kind: "chat", id: p.chat_id, title: groupTopic.trim() || (en ? "New group" : "Nouveau groupe") });
    void load();
  };

  const q = query.trim().toLowerCase();
  const filteredChats = useMemo(() => !q ? chats : chats.filter((c) => JSON.stringify(c).toLowerCase().includes(q)), [chats, q]);
  const pName = (p: any) => p.name ?? p.displayName ?? "";
  const pMail = (p: any) => p.mail ?? p.email ?? p.userPrincipalName ?? "";
  const filteredPeople = useMemo(
    () => (!q ? people : people.filter((p) => `${pName(p)} ${pMail(p)} ${p.title ?? ""}`.toLowerCase().includes(q))),
    [people, q],
  );


  if (err === "ms365_not_connected") {
    return <div className="pp-card"><PPEmptyState icon={<Users className="w-5 h-5" />}
      title={en ? "Microsoft 365 not connected" : "Microsoft 365 non connecté"}
      description={en ? "Connect your account from Settings." : "Connectez votre compte dans Réglages."} /></div>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      {/* Left column */}
      <div className="pp-card" style={{ padding: 0, display: "flex", flexDirection: "column", maxHeight: 620 }}>
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en ? "Search…" : "Rechercher…"}
            className="pp-input flex-1" style={{ fontSize: 12 }} />
          <button onClick={() => void load()} title={en ? "Refresh" : "Actualiser"}><RefreshCw className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} /></button>
        </div>
        <div className="flex gap-1 px-3 py-2" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
          {([["chats", en ? "Chats" : "Conversations"], ["people", en ? "People" : "Personnes"], ["teams", en ? "Teams" : "Équipes"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k as any)} className="px-2.5 py-1 rounded-lg text-[12px]"
              style={tab === k
                ? { background: "var(--pp-brand-accent-2)", color: "#fff", fontWeight: 700 }
                : { color: "var(--pp-text-secondary)" }}>{label}</button>
          ))}
          <button onClick={() => setGroupOpen(true)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[12px]"
            style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            <Plus className="w-3 h-3" />{en ? "Group" : "Groupe"}
          </button>
        </div>

        <div className="overflow-y-auto" style={{ flex: 1 }}>
          {loading ? (
            <div className="p-3 space-y-2">{[0, 1, 2, 3].map((i) => <PPSkeleton key={i} className="h-9 w-full" />)}</div>
          ) : tab === "chats" ? (
            filteredChats.length === 0
              ? <PPEmptyState icon={<MessageSquare className="w-5 h-5" />} title={en ? "No conversations" : "Aucune conversation"} />
              : filteredChats.map((c) => (
                <button key={c.id} onClick={() => openThread({ kind: "chat", id: c.id, title: c.topic || (en ? "Chat" : "Conversation") })}
                  className="w-full text-left px-3 py-2.5" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                  <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{c.topic || (en ? "Chat" : "Conversation")}</div>
                  <div className="truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                    {(c.preview || "").replace(/<[^>]*>/g, "").slice(0, 70)}
                  </div>
                </button>
              ))
          ) : tab === "people" ? (
            filteredPeople.length === 0
              ? <PPEmptyState icon={<Users className="w-5 h-5" />} title={en ? "No people" : "Aucune personne"} />
              : <>
                <div className="px-3 py-1.5" style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                  {filteredPeople.length} {en ? "people" : "personnes"}
                </div>
                {filteredPeople.map((p) => (
                  <button key={p.id} onClick={() => void startDirect(p)} className="w-full text-left px-3 py-2.5 flex items-center gap-2"
                    style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                    <span className="shrink-0 rounded-full" style={{ width: 8, height: 8, background: presenceColor(p.presence?.availability) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{pName(p)}</span>
                      <span className="block truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                        {pMail(p)}{p.title ? ` · ${p.title}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--pp-text-muted)" }}>
                      {presenceLabel(p.presence?.availability, en)}
                    </span>
                  </button>
                ))}
              </>

          ) : (
            teams.length === 0
              ? <PPEmptyState icon={<Hash className="w-5 h-5" />} title={en ? "No teams" : "Aucune équipe"} />
              : teams.map((tm) => (
                <div key={tm.id} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                  <div className="px-3 pt-2.5" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--pp-text-primary)" }}>{tm.displayName}</div>
                  {(tm.channels ?? []).map((ch: any) => (
                    <button key={ch.id} onClick={() => openThread({ kind: "channel", teamId: tm.id, channelId: ch.id, title: `${tm.displayName} · ${ch.displayName}` })}
                      className="w-full text-left px-4 py-1.5 flex items-center gap-1.5" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
                      <Hash className="w-3 h-3" />{ch.displayName}
                    </button>
                  ))}
                </div>
              ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="pp-card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 420, maxHeight: 620 }}>
        {!active ? (
          <PPEmptyState icon={<MessageSquare className="w-5 h-5" />}
            title={en ? "Select a conversation" : "Sélectionnez une conversation"}
            description={en ? "Chats, people and channels are on the left." : "Conversations, personnes et canaux à gauche."} />
        ) : (
          <>
            <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
              <div className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--pp-text-primary)" }}>{active.title}</div>
              <button onClick={() => void loadMessages(active)}><RefreshCw className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-2" style={{ flex: 1 }}>
              {msgLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-12 w-full" />)}</div>
              ) : messages.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--pp-text-muted)" }}>{en ? "No messages yet." : "Aucun message."}</div>
              ) : messages.map((m) => (
                <div key={m.id} className={m.isMe ? "ml-auto" : ""} style={{ maxWidth: "80%" }}>
                  <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{m.from} · {fmtDateTime(m.createdAt, lang)}</div>
                  <div className="rounded-xl px-3 py-2" style={{
                    background: m.isMe ? "var(--pp-brand-accent-2)" : "var(--pp-bg-subtle, #f1f5f9)",
                    color: m.isMe ? "#fff" : "var(--pp-text-primary)", fontSize: 13,
                  }}>
                    <div dangerouslySetInnerHTML={{ __html: m.content || "" }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-3 flex items-end gap-2" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={en ? "Write a message…" : "Écrire un message…"} className="pp-input flex-1" style={{ fontSize: 13, resize: "none" }} />
              <button onClick={() => void send()} disabled={sending || !draft.trim()}
                className="px-3 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: "var(--pp-brand-accent-2)" }}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </>
        )}
      </div>

      {groupOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setGroupOpen(false)}>
          <div className="pp-card w-full max-w-lg" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <h3 className="pp-heading" style={{ fontSize: 15.5, fontWeight: 700 }}>{en ? "New group chat" : "Nouveau groupe"}</h3>
              <button onClick={() => setGroupOpen(false)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            <input value={groupTopic} onChange={(e) => setGroupTopic(e.target.value)} className="pp-input w-full" style={{ fontSize: 13 }}
              placeholder={en ? "Group name (optional)" : "Nom du groupe (optionnel)"} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="pp-input w-full" style={{ fontSize: 13, marginTop: 8 }}
              placeholder={en ? "Search people…" : "Rechercher des personnes…"} />
            <div className="overflow-y-auto" style={{ maxHeight: 280, marginTop: 8 }}>
              {filteredPeople.slice(0, 150).map((p) => {
                const on = selected.has(p.id);
                return (
                  <button key={p.id} onClick={() => setSelected((s) => { const n = new Set(s); on ? n.delete(p.id) : n.add(p.id); return n; })}
                    className="w-full text-left px-3 py-2 flex items-center justify-between" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                    <span style={{ fontSize: 13, color: "var(--pp-text-primary)" }}>{p.displayName}
                      <span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}> · {p.mail ?? p.userPrincipalName}</span>
                    </span>
                    <span style={{ fontSize: 12, color: on ? "var(--pp-brand-accent-2)" : "var(--pp-text-muted)", fontWeight: on ? 700 : 400 }}>
                      {on ? "✓" : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                {selected.size} {en ? "selected" : "sélectionné(s)"}
              </span>
              <button onClick={() => void createGroup()} disabled={creating || selected.size === 0}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--pp-brand-accent-2)" }}>
                {creating ? (en ? "Creating…" : "Création…") : (en ? "Create & chat" : "Créer et discuter")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  async function startDirect(p: any) {
    const { data, error } = await supabase.functions.invoke("ms365-teams-messages", {
      body: { action: "create_chat", user_ids: [p.id] },
    });
    const res = (data as any) ?? {};
    if (error || res.error || !res.chat_id) {
      toast.error(res.error || error?.message || (en ? "Could not open the chat" : "Impossible d'ouvrir la conversation"));
      return;
    }
    openThread({ kind: "chat", id: res.chat_id, title: p.displayName });
  }
}
