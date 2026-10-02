import { useEffect, useMemo, useState } from "react";
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

  const btn = "pa-btn";
  const primary = `${btn} pa-btn-primary`;
  const ghost = btn;

  return (
    <PAPage className="pp-marketing">
      <PAPageHeader icon={<Megaphone className="w-5 h-5" />} title={L("Marketing", "Marketing")}
        subtitle={L("Envoyez un texto et/ou un courriel à vos clients Maestro.", "Send a text and/or email to your Maestro clients.")} />

      <div className="flex gap-2 mb-4">
        <button className={tab === "new" ? primary : ghost} onClick={() => setTab("new")}>{L("Nouvel envoi", "New send")}</button>
        <button className={tab === "history" ? primary : ghost} onClick={() => setTab("history")}>{L("Historique", "History")}</button>
      </div>

      {tab === "history" ? <MarketingHistory lang={lang} reloadKey={reloadKey} /> : (
        <div className="space-y-4">
          <ol className="pp-marketing-steps flex gap-2 text-xs" aria-label={L("Étapes de l'envoi", "Sending steps")}>
            {[L("Écrire", "Write"), L("Valider", "Review"), L("Clients", "Clients"), L("Envoyer", "Send")].map((s, i) => (
               <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-full px-3 py-1 border ${step === i + 1 ? "pp-marketing-step-active" : "pp-marketing-step"}`}>{i + 1}. {s}</li>
            ))}
          </ol>

          {step === 1 && (
            <div className="pp-marketing-panel p-4 space-y-3">
              <label htmlFor="marketing-prompt" className="pp-marketing-label text-sm font-semibold">{L("Votre message", "Your message")}</label>
              <p className="pp-marketing-help text-xs">{L("Astuce : {prenom}, {nom} et {nom_complet} sont remplacés par le nom de chaque client à l'envoi.", "Tip: {prenom}, {nom} and {nom_complet} are replaced with each client's name when sending.")}</p>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} rows={5}
                id="marketing-prompt"
                placeholder={L("Ex. : Rappeler à mes clients que leur renouvellement approche et offrir une révision gratuite.", "E.g. Remind clients their renewal is coming and offer a free review.")}
                className="pp-marketing-field w-full rounded-lg border p-3 text-sm" />
              <div className="pp-marketing-channels flex flex-wrap gap-3 text-sm">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={useSms} onChange={(e) => setUseSms(e.target.checked)} /><MessageSquare className="w-4 h-4" />{L("Texto", "Text")}</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={useEmail} onChange={(e) => setUseEmail(e.target.checked)} /><Mail className="w-4 h-4" />{L("Courriel", "Email")}</label>
              </div>
              <button className={primary} disabled={busy || prompt.trim().length < 5 || !channels.length} onClick={() => void generate(0)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{L("Générer avec l'IA", "Generate with AI")}
              </button>
            </div>
          )}

          {step === 2 && draft && (
            <div className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
                {useEmail && (
                  <div className="pp-marketing-panel p-3 space-y-2">
                    <div className="text-sm font-semibold flex items-center gap-2"><Mail className="w-4 h-4" />{L("Courriel", "Email")}</div>
                    {editing ? (<>
                      <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={150} className="pp-marketing-field w-full rounded-lg border p-2 text-sm" />
                      <textarea value={draft.email_body_html} onChange={(e) => setDraft({ ...draft, email_body_html: e.target.value })} rows={12} className="pp-marketing-field w-full rounded-lg border p-2 text-xs font-mono" />
                    </>) : (<>
                      <div className="text-sm"><span className="text-muted-foreground">{L("Objet", "Subject")} : </span>{draft.subject}</div>
                      <iframe title="preview" sandbox="" srcDoc={draft.email_preview_html} className="w-full h-[480px] rounded-lg border border-border bg-background" />
                    </>)}
                  </div>
                )}
                {useSms && (
                  <div className="pp-marketing-panel p-3 space-y-2">
                    <div className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4" />{L("Texto", "Text")}</div>
                    {editing ? (
                       <textarea value={draft.sms_text} onChange={(e) => setDraft({ ...draft, sms_text: e.target.value })} maxLength={480} rows={6} className="pp-marketing-field w-full rounded-lg border p-2 text-sm" />
                    ) : (
                      <div className="rounded-2xl bg-muted p-3 text-sm whitespace-pre-wrap max-w-sm">{draft.sms_text}</div>
                    )}
                    <div className="text-xs text-muted-foreground">{draft.sms_text.length} / 480</div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={ghost} onClick={() => setStep(1)}>{L("Retour", "Back")}</button>
                <button className={ghost} disabled={busy} onClick={() => void generate(variant + 1)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{L("Régénérer", "Regenerate")}</button>
                <button className={ghost} onClick={() => setEditing((v) => !v)}><Pencil className="w-4 h-4" />{editing ? L("Terminer la modification", "Done editing") : L("Modifier à la main", "Edit manually")}</button>
                <button className={primary} onClick={() => setStep(3)}><Check className="w-4 h-4" />{L("Confirmer", "Confirm")}</button>
              </div>
              {editing && useEmail && <p className="text-xs text-muted-foreground">{L("L'aperçu du courriel se met à jour à la prochaine génération; vos modifications seront envoyées telles quelles.", "Preview refreshes on next generation; your edits are sent as written.")}</p>}
            </div>
          )}

          {step === 3 && (
            <div className="pp-marketing-panel p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                   <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Rechercher un client", "Search clients")} className="pp-marketing-field w-full rounded-lg border py-2 pl-9 pr-3 text-sm" />
                </div>
                <button className={ghost} disabled={!filtered.length} onClick={() => setSel((s) => { const n = new Set(s); filtered.forEach((c) => allSel ? n.delete(c.id) : n.add(c.id)); return n; })}>
                  {allSel ? L("Tout désélectionner", "Deselect all") : L("Tout sélectionner", "Select all")}
                </button>
              </div>
              {clients === null ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{L("Chargement de vos clients Maestro…", "Loading your Maestro clients…")}</div>
                : clientsErr && !clients.length ? <p className="text-sm text-destructive">{clientsErr}</p>
                : (
                  <div className="max-h-[480px] overflow-y-auto divide-y divide-border rounded-lg border border-border">
                    {filtered.map((c) => (
                      <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                        <input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                        <span className="flex-1 min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted-foreground">{c.phone || L("Aucun cellulaire", "No mobile")} · {c.email || L("Aucun courriel", "No email")}</span></span>
                        <span className={`inline-flex items-center gap-1 text-xs ${phoneOk(c.phone) ? "text-foreground" : "text-muted-foreground line-through"}`}><MessageSquare className="w-3.5 h-3.5" />{L("Cell.", "Mobile")}</span>
                        <span className={`inline-flex items-center gap-1 text-xs ${emailOk(c.email) ? "text-foreground" : "text-muted-foreground line-through"}`}><Mail className="w-3.5 h-3.5" />{L("Courriel", "Email")}</span>
                      </label>
                    ))}
                    {!filtered.length && <p className="p-4 text-sm text-muted-foreground">{L("Aucun client.", "No clients.")}</p>}
                  </div>
                )}
              <div className="text-sm">{sel.size} {L("client(s) sélectionné(s)", "client(s) selected")} · {nSms} {L("texto(s)", "text(s)")} · {nEmail} {L("courriel(s)", "email(s)")}</div>
              <div className="flex gap-2">
                <button className={ghost} onClick={() => setStep(2)}>{L("Retour", "Back")}</button>
                <button className={primary} disabled={nSms + nEmail === 0} onClick={() => setConfirmOpen(true)}><Send className="w-4 h-4" />{L("Envoyer", "Send")}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => !busy && setConfirmOpen(false)}>
          <div className="pp-marketing-panel w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{L("Confirmer l'envoi réel", "Confirm real send")}</h3>
            <ul className="text-sm space-y-1">
              {useSms && <li>• {nSms} {L("texto(s) depuis votre numéro Planiprêt", "text(s) from your Planiprêt number")}</li>}
              {useEmail && <li>• {nEmail} {L("courriel(s) depuis votre boîte Outlook", "email(s) from your Outlook mailbox")}</li>}
            </ul>
            <p className="text-xs text-muted-foreground">{L("Les clients sans cellulaire ou courriel valide sont ignorés. Cette action est irréversible.", "Clients without a valid mobile or email are skipped. This cannot be undone.")}</p>
            <div className="flex gap-2 justify-end">
              <button className={ghost} disabled={busy} onClick={() => setConfirmOpen(false)}>{L("Annuler", "Cancel")}</button>
              <button className={primary} disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{L("Envoyer maintenant", "Send now")}</button>
            </div>
          </div>
        </div>
      )}
    </PAPage>
  );
}
