import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, msgPeer } from "@/lib/planipret/brokerFormat";

type Thread = { key: string; peer: string; last: any; messages: any[]; unread: number };

export default function PBMessages() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from("planipret_phone_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [userId]);

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    for (const m of rows) {
      const peer = msgPeer(m);
      const key = m.thread_id || peer;
      const existing = map.get(key);
      if (existing) {
        existing.messages.push(m);
        if (m.direction === "inbound" && !m.read_at) existing.unread += 1;
      } else {
        map.set(key, { key, peer, last: m, messages: [m], unread: m.direction === "inbound" && !m.read_at ? 1 : 0 });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const active = threads.find((t) => t.key === activeKey) ?? threads[0] ?? null;
  const ordered = active ? [...active.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [];

  useEffect(() => {
    if (!active || active.unread === 0) return;
    const ids = active.messages.filter((m) => m.direction === "inbound" && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    void supabase.from("planipret_phone_messages").update({ read_at: new Date().toISOString() }).in("id", ids);
  }, [active?.key]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !active || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("pp-ns-messages", {
        body: { action: "send", to: active.peer, message: body },
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      setDraft("");
      toast.success(lang === "en" ? "Message sent" : "Message envoyé");
      await load();
    } catch (e: any) {
      toast.error(e?.message || (lang === "en" ? "Send failed" : "Envoi impossible"));
    } finally {
      setSending(false);
    }
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<MessageSquare className="w-4 h-4" />}
        title={lang === "en" ? "My texts" : "Mes textos"}
        subtitle={`${threads.length} ${lang === "en" ? "conversations" : "conversations"}`}
      />

      {loading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-10 w-full" />)}</div>
      ) : threads.length === 0 ? (
        <div className="pp-card"><PPEmptyState icon={<MessageSquare className="w-5 h-5" />} title={lang === "en" ? "No messages" : "Aucun message"} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="pp-card overflow-y-auto" style={{ padding: 0, maxHeight: "70vh" }}>
            {threads.map((t) => (
              <button key={t.key} onClick={() => setActiveKey(t.key)}
                className="w-full text-left px-3 py-2.5"
                style={{
                  borderBottom: "1px solid var(--pp-bg-border)",
                  background: active?.key === t.key ? "var(--pp-bg-elevated)" : "transparent",
                }}>
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{t.peer}</span>
                  {t.unread > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--pp-danger)", borderRadius: 999, padding: "1px 6px" }}>{t.unread}</span>
                  )}
                </div>
                <div className="truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{t.last.body ?? "—"}</div>
              </button>
            ))}
          </div>

          <div className="pp-card flex flex-col" style={{ padding: 0, maxHeight: "70vh" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
              <span className="pp-heading" style={{ fontSize: 14, fontWeight: 700 }}>{active?.peer}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {ordered.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div style={{
                    maxWidth: "72%", borderRadius: 14, padding: "8px 12px", fontSize: 13,
                    background: m.direction === "outbound" ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
                    color: m.direction === "outbound" ? "#fff" : "var(--pp-text-primary)",
                  }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>{fmtDateTime(m.sent_at ?? m.created_at, lang)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 p-3" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={lang === "en" ? "Write a message…" : "Écrire un message…"}
                className="pp-input flex-1" style={{ fontSize: 13 }} />
              <button onClick={() => void send()} disabled={sending || !draft.trim()}
                className="pp-btn-primary flex items-center gap-1.5 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" />{lang === "en" ? "Send" : "Envoyer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PAPage>
  );
}
