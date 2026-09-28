import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, Loader2, Mail, Megaphone, MessageSquare, Pencil, RefreshCw, Search, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import MarketingHistory from "@/components/planipret/marketing/MarketingHistory";

type Client = { id: string; name: string; phone: string | null; email: string | null };
type Draft = { subject: string; email_body_html: string; sms_text: string; email_preview_html: string };

const phoneOk = (p: string | null) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 10 || (d.length === 11 && d.startsWith("1")); };
const emailOk = (e: string | null) => /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i.test(String(e ?? "").trim());

/* Planiprêt portal look (pp-* tokens), same as the other broker pages. */
const card: CSSProperties = {
  background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)",
  borderRadius: 14, padding: 16, color: "var(--pp-text-primary)",
};
const input: CSSProperties = {
  width: "100%", background: "var(--pp-bg-deep)", color: "var(--pp-text-primary)",
  border: "1px solid var(--pp-bg-border)", borderRadius: 10, padding: "10px 12px", fontSize: 14,
};
const btnBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  borderRadius: 10, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const btnPrimary: CSSProperties = { ...btnBase, background: "var(--pp-brand-accent-2, #2E9BDC)", border: "1px solid var(--pp-brand-accent-2, #2E9BDC)", color: "#fff" };
const btnGhost: CSSProperties = { ...btnBase, background: "transparent", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };
const muted: CSSProperties = { color: "var(--pp-text-muted)" };

export default function PBMarketing() {
  const { lang } = useMplanipretLang();
  const L = (fr: string, en: string) => (lang === "en" ? en : fr);
  const [tab, setTab] = useState<"new" | "history">("new");
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [useSms, setUseSms] = useState(true);
  const [useEmail, setUseEmail] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [variant, setVariant] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsErr, setClientsErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const channels = [useSms && "sms", useEmail && "email"].filter(Boolean) as string[];

  const generate = async (v = 0) => {
    if (prompt.trim().length < 5 || !channels.length) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("pp-marketing-compose", { body: { prompt: prompt.trim(), lang, variant: v } });
      const d = data as any;
      if (error || !d?.ok) throw new Error(d?.error === "ai_unavailable" ? L("IA temporairement indisponible", "AI temporarily unavailable") : L("Génération impossible, réessayez", "Could not generate, try again"));
      setDraft({ subject: d.subject, email_body_html: d.email_body_html, sms_text: d.sms_text, email_preview_html: d.email_preview_html });
      setVariant(v); setEditing(false); setStep(2);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (step !== 3 || clients) return;
    void (async () => {
      const all: Client[] = [];
      let offset = 0;
      for (let i = 0; i < 4; i++) {
        const { data } = await supabase.functions.invoke("maestro-actions", { body: { action: "list_clients", payload: { limit: 250, offset } } });
        const d = data as any;
        if (!d?.success) { setClientsErr(d?.error ?? L("Clients Maestro indisponibles", "Maestro clients unavailable")); break; }
        for (const c of d.clients ?? []) {
          all.push({ id: String(c.id ?? ""), name: String(c.name ?? c.display_name ?? "Client"), phone: c.cell_phone ?? c.phone ?? null, email: c.email ?? null });
        }
        if (!d.has_more || d.next_offset == null) break;
        offset = d.next_offset;
      }
      setClients(all);
    })();
  }, [step, clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q));
  }, [clients, search]);

  const chosen = (clients ?? []).filter((c) => sel.has(c.id));
  const nSms = useSms ? chosen.filter((c) => phoneOk(c.phone)).length : 0;
  const nEmail = useEmail ? chosen.filter((c) => emailOk(c.email)).length : 0;
  const allSel = filtered.length > 0 && filtered.every((c) => sel.has(c.id));

  const send = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("pp-marketing-send", {
        body: {
          confirmed: true, channels, prompt, subject: draft.subject, email_body_html: draft.email_body_html, sms_text: draft.sms_text,
          targets: chosen.map((c) => ({ client_id: c.id, name: c.name, phone: c.phone, email: c.email })),
        },
      });
      const d = data as any;
      if (d?.error === "outlook_not_connected") throw new Error(L("Connectez Outlook dans Microsoft 365 avant d'envoyer des courriels.", "Connect Outlook in Microsoft 365 before sending emails."));
      if (d?.error === "duplicate_send") throw new Error(L("Cette campagne vient déjà d'être envoyée.", "This campaign was just sent."));
      if (error || !d?.ok) throw new Error(L("Envoi impossible", "Send failed"));
      toast.success(L(`Envoyé : ${d.sent_email} courriel(s), ${d.sent_sms} texto(s)`, `Sent: ${d.sent_email} email(s), ${d.sent_sms} text(s)`),
        { description: d.failed ? L(`${d.failed} échec(s) — voir l'historique`, `${d.failed} failure(s) — see history`) : undefined });
      setConfirmOpen(false); setStep(1); setDraft(null); setPrompt(""); setSel(new Set()); setReloadKey((k) => k + 1); setTab("history");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const pill = (active: boolean): CSSProperties => ({
    borderRadius: 999, padding: "4px 14px", fontSize: 12, border: "1px solid var(--pp-bg-border)",
    background: active ? "var(--pp-brand-accent-2, #2E9BDC)" : "transparent",
    color: active ? "#fff" : "var(--pp-text-muted)", cursor: "default",
  });

  return (
    <PAPage>
      <PAPageHeader icon={<Megaphone className="w-5 h-5" />} title="Marketing"
        subtitle={L("Envoyez un texto et/ou un courriel à vos clients Maestro.", "Send a text and/or email to your Maestro clients.")} />

      <div className="flex gap-2 mb-4">
        <button style={tab === "new" ? btnPrimary : btnGhost} onClick={() => setTab("new")}>{L("Nouvel envoi", "New send")}</button>
        <button style={tab === "history" ? btnPrimary : btnGhost} onClick={() => setTab("history")}>{L("Historique", "History")}</button>
      </div>

      {tab === "history" ? <MarketingHistory lang={lang} reloadKey={reloadKey} /> : (
        <div className="space-y-4">
          <ol className="flex flex-wrap gap-2">
            {[L("Écrire", "Write"), L("Valider", "Review"), L("Clients", "Clients"), L("Envoyer", "Send")].map((s, i) => (
              <li key={s} style={pill(step === i + 1)}>{i + 1}. {s}</li>
            ))}
          </ol>

          {step === 1 && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>{L("Votre message", "Your message")}</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} rows={5}
                placeholder={L("Ex. : Rappeler à mes clients que leur renouvellement approche et offrir une révision gratuite.", "E.g. Remind clients their renewal is coming and offer a free review.")}
                style={{ ...input, resize: "vertical" }} />
              <div className="flex gap-5" style={{ fontSize: 14 }}>
                <label className="inline-flex items-center gap-2" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={useSms} onChange={(e) => setUseSms(e.target.checked)} />
                  <MessageSquare className="w-4 h-4" />{L("Texto", "Text")}
                </label>
                <label className="inline-flex items-center gap-2" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={useEmail} onChange={(e) => setUseEmail(e.target.checked)} />
                  <Mail className="w-4 h-4" />{L("Courriel", "Email")}
                </label>
              </div>
              <div>
                <button style={{ ...btnPrimary, opacity: busy || prompt.trim().length < 5 || !channels.length ? 0.55 : 1 }}
                  disabled={busy || prompt.trim().length < 5 || !channels.length} onClick={() => void generate(0)}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{L("Générer avec l'IA", "Generate with AI")}
                </button>
              </div>
            </div>
          )}

          {step === 2 && draft && (
            <div className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
                {useEmail && (
                  <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}><Mail className="w-4 h-4" />{L("Courriel", "Email")}</div>
                    {editing ? (<>
                      <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={150} style={input} />
                      <textarea value={draft.email_body_html} onChange={(e) => setDraft({ ...draft, email_body_html: e.target.value })} rows={12} style={{ ...input, fontSize: 12, fontFamily: "monospace" }} />
                    </>) : (<>
                      <div style={{ fontSize: 14 }}><span style={muted}>{L("Objet", "Subject")} : </span>{draft.subject}</div>
                      <iframe title="preview" sandbox="" srcDoc={draft.email_preview_html} className="w-full h-[480px] rounded-lg" style={{ border: "1px solid var(--pp-bg-border)", background: "#fff" }} />
                    </>)}
                  </div>
                )}
                {useSms && (
                  <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}><MessageSquare className="w-4 h-4" />{L("Texto", "Text")}</div>
                    {editing ? (
                      <textarea value={draft.sms_text} onChange={(e) => setDraft({ ...draft, sms_text: e.target.value })} maxLength={480} rows={6} style={input} />
                    ) : (
                      <div className="rounded-2xl p-3 text-sm whitespace-pre-wrap max-w-sm" style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border)" }}>{draft.sms_text}</div>
                    )}
                    <div style={{ ...muted, fontSize: 12 }}>{draft.sms_text.length} / 480</div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button style={btnGhost} onClick={() => setStep(1)}>{L("Retour", "Back")}</button>
                <button style={btnGhost} disabled={busy} onClick={() => void generate(variant + 1)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{L("Régénérer", "Regenerate")}</button>
                <button style={btnGhost} onClick={() => setEditing((v) => !v)}><Pencil className="w-4 h-4" />{editing ? L("Terminer la modification", "Done editing") : L("Modifier à la main", "Edit manually")}</button>
                <button style={btnPrimary} onClick={() => setStep(3)}><Check className="w-4 h-4" />{L("Confirmer", "Confirm")}</button>
              </div>
              {editing && useEmail && <p style={{ ...muted, fontSize: 12 }}>{L("L'aperçu du courriel se met à jour à la prochaine génération; vos modifications seront envoyées telles quelles.", "Preview refreshes on next generation; your edits are sent as written.")}</p>}
            </div>
          )}

          {step === 3 && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5" style={{ color: "var(--pp-text-muted)" }} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Rechercher un client", "Search clients")} style={{ ...input, paddingLeft: 36 }} />
                </div>
                <button style={btnGhost} disabled={!filtered.length} onClick={() => setSel((s) => { const n = new Set(s); filtered.forEach((c) => allSel ? n.delete(c.id) : n.add(c.id)); return n; })}>
                  {allSel ? L("Tout désélectionner", "Deselect all") : L("Tout sélectionner", "Select all")}
                </button>
              </div>
              {clients === null ? <div className="flex items-center gap-2" style={{ ...muted, fontSize: 14 }}><Loader2 className="w-4 h-4 animate-spin" />{L("Chargement de vos clients Maestro…", "Loading your Maestro clients…")}</div>
                : clientsErr && !clients.length ? <p style={{ color: "var(--pp-danger, #FF6B6B)", fontSize: 14 }}>{clientsErr}</p>
                : (
                  <div className="max-h-[480px] overflow-y-auto rounded-lg" style={{ border: "1px solid var(--pp-bg-border)" }}>
                    {filtered.map((c) => (
                      <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm" style={{ cursor: "pointer", borderBottom: "1px solid var(--pp-bg-border)" }}>
                        <input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: phoneOk(c.phone) ? "var(--pp-text-primary)" : "var(--pp-text-faint)", textDecoration: phoneOk(c.phone) ? "none" : "line-through" }}><MessageSquare className="w-3.5 h-3.5" />{L("Cell.", "Mobile")}</span>
                        <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: emailOk(c.email) ? "var(--pp-text-primary)" : "var(--pp-text-faint)", textDecoration: emailOk(c.email) ? "none" : "line-through" }}><Mail className="w-3.5 h-3.5" />{L("Courriel", "Email")}</span>
                      </label>
                    ))}
                    {!filtered.length && <p className="p-4" style={{ ...muted, fontSize: 14 }}>{L("Aucun client.", "No clients.")}</p>}
                  </div>
                )}
              <div style={{ fontSize: 14 }}>{sel.size} {L("client(s) sélectionné(s)", "client(s) selected")} · {nSms} {L("texto(s)", "text(s)")} · {nEmail} {L("courriel(s)", "email(s)")}</div>
              <div className="flex gap-2">
                <button style={btnGhost} onClick={() => setStep(2)}>{L("Retour", "Back")}</button>
                <button style={{ ...btnPrimary, opacity: nSms + nEmail === 0 ? 0.55 : 1 }} disabled={nSms + nEmail === 0} onClick={() => setConfirmOpen(true)}><Send className="w-4 h-4" />{L("Envoyer", "Send")}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,11,22,.8)" }} onClick={() => !busy && setConfirmOpen(false)}>
          <div className="w-full max-w-md space-y-3" style={{ ...card, borderRadius: 16, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>{L("Confirmer l'envoi réel", "Confirm real send")}</h3>
            <ul style={{ fontSize: 14 }} className="space-y-1">
              {useSms && <li>• {nSms} {L("texto(s) depuis votre numéro Planiprêt", "text(s) from your Planiprêt number")}</li>}
              {useEmail && <li>• {nEmail} {L("courriel(s) depuis votre boîte Outlook", "email(s) from your Outlook mailbox")}</li>}
            </ul>
            <p style={{ ...muted, fontSize: 12 }}>{L("Les clients sans cellulaire ou courriel valide sont ignorés. Cette action est irréversible.", "Clients without a valid mobile or email are skipped. This cannot be undone.")}</p>
            <div className="flex gap-2 justify-end">
              <button style={btnGhost} disabled={busy} onClick={() => setConfirmOpen(false)}>{L("Annuler", "Cancel")}</button>
              <button style={btnPrimary} disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{L("Envoyer maintenant", "Send now")}</button>
            </div>
          </div>
        </div>
      )}
    </PAPage>
  );
}
