import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Send, Sparkles, Loader2 } from "lucide-react";

type Lang = "fr" | "en";

export type ComposeInit = {
  mode: "new" | "reply" | "replyAll" | "forward";
  messageId?: string;
  to?: string;
  subject?: string;
  body?: string;
};

export default function ComposeEmailDialog({
  init, lang, onClose, onSent,
}: { init: ComposeInit; lang: Lang; onClose: () => void; onSent?: () => void }) {
  const en = lang === "en";
  const [to, setTo] = useState(init.to ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(init.subject ?? "");
  const [body, setBody] = useState(init.body ?? "");
  const [sending, setSending] = useState(false);
  const [improving, setImproving] = useState(false);

  const isReply = init.mode === "reply" || init.mode === "replyAll";

  const improve = async () => {
    if (!body.trim()) return;
    setImproving(true);
    const { data } = await supabase.functions.invoke("ai-text-improve", {
      body: { text: body, mode: "email", action: "improve" },
    });
    setImproving(false);
    const txt = (data as any)?.text ?? (data as any)?.result;
    if (txt) setBody(String(txt));
    else toast.error(en ? "AI improvement failed" : "Amélioration IA impossible");
  };

  const send = async () => {
    const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!isReply && (!list(to).length || !subject.trim())) {
      toast.error(en ? "Recipient and subject are required" : "Destinataire et objet requis");
      return;
    }
    if (!body.trim()) { toast.error(en ? "Message is empty" : "Message vide"); return; }
    setSending(true);
    const action = init.mode === "reply" ? "reply_email"
      : init.mode === "replyAll" ? "reply_all_email"
      : init.mode === "forward" ? "forward_email" : "send_email";
    const payload: any = isReply
      ? { message_id: init.messageId, body }
      : init.mode === "forward"
        ? { message_id: init.messageId, to: list(to), comment: body, body }
        : { to: list(to), cc: list(cc), subject, body };
    const { data, error } = await supabase.functions.invoke("ms365-actions", { body: { action, payload } });
    setSending(false);
    const res = data as any;
    if (error || !res?.success) {
      toast.error(res?.error || error?.message || (en ? "Send failed" : "Échec de l'envoi"));
      return;
    }
    toast.success(en ? "Email sent" : "Courriel envoyé");
    onSent?.();
    onClose();
  };

  const title = init.mode === "new" ? (en ? "New email" : "Nouveau courriel")
    : init.mode === "forward" ? (en ? "Forward" : "Transférer")
    : init.mode === "replyAll" ? (en ? "Reply all" : "Répondre à tous")
    : (en ? "Reply" : "Répondre");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="pp-card w-full max-w-2xl" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3" style={{ marginBottom: 10 }}>
          <h3 className="pp-heading" style={{ fontSize: 15.5, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
        </div>

        <div className="space-y-2">
          {!isReply && (
            <>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="pp-input w-full" style={{ fontSize: 13 }}
                placeholder={en ? "To (comma separated)" : "À (séparés par des virgules)"} />
              {init.mode === "new" && (
                <>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} className="pp-input w-full" style={{ fontSize: 13 }} placeholder="Cc" />
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} className="pp-input w-full" style={{ fontSize: 13 }}
                    placeholder={en ? "Subject" : "Objet"} />
                </>
              )}
            </>
          )}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="pp-input w-full" style={{ fontSize: 13, resize: "vertical" }}
            placeholder={en ? "Write your message…" : "Rédigez votre message…"} />
        </div>

        <div className="flex items-center justify-between gap-2" style={{ marginTop: 12 }}>
          <button onClick={() => void improve()} disabled={improving || !body.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] disabled:opacity-40"
            style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {improving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" style={{ color: "#9B7FE8" }} />}
            {en ? "Improve with AI" : "Améliorer avec l'IA"}
          </button>
          <button onClick={() => void send()} disabled={sending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--pp-brand-accent-2)" }}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {en ? "Send" : "Envoyer"}
          </button>
        </div>
      </div>
    </div>
  );
}
