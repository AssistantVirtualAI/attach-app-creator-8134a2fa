import { useEffect, useRef, useState } from "react";
import { Send, Loader2, UserRound, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPpContacts } from "@/lib/ppContactsCache";
import { portalSmsContacts, filterPortalSmsContacts, type PortalSmsContact } from "@/lib/planipret/portalSmsContacts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSmsAvailability, type SmsAvailability } from "@/lib/planipret/smsAvailability";
import { isInternalMessageRecipient, normalizePortalMessageRecipient } from "@/lib/planipret/portalMessageRecipient";
import { getSmsSubmission, type SmsSubmission } from "@/lib/planipret/smsSendGuard";

export default function PortalSmsComposer({ target, userId, lang, onClose, onSent, inline = false }: {
  target: { number: string } | null;
  userId: string;
  lang: "en" | "fr";
  onClose: () => void;
  onSent: () => void;
  inline?: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [availability, setAvailability] = useState<SmsAvailability | null>(null);
  const [contacts, setContacts] = useState<PortalSmsContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<PortalSmsContact | null>(null);
  const submission = useRef<SmsSubmission | null>(null);
  const sending = useRef(false);
  const tr = (fr: string, en: string) => lang === "en" ? en : fr;

  useEffect(() => {
    let current = true;
    setRecipient(target?.number ?? "");
    setBody("");
    setFailure(null);
    setAvailability(null);
    setContacts([]);
    setSelected(null);
    setPickerOpen(!target?.number);
    setContactsError(false);
    setContactsLoading(Boolean(target && userId));
    submission.current = null;
    if (target && userId) void getSmsAvailability(true).then((value) => { if (current) setAvailability(value); });
    if (target && userId && !inline) void Promise.allSettled([
      getPpContacts("list"), getPpContacts("directory"), getPpContacts("maestro_clients"),
    ]).then((results) => {
      if (!current) return;
      setContacts(portalSmsContacts(results.flatMap((result) => result.status === "fulfilled" ? result.value : [])));
      setContactsError(results.some((result) => result.status === "rejected"));
      setContactsLoading(false);
    });
    return () => { current = false; };
  }, [target?.number, Boolean(target), userId, inline]);

  const to = normalizePortalMessageRecipient(recipient);
  const internal = isInternalMessageRecipient(recipient);
  const matches = filterPortalSmsContacts(contacts, recipient);
  const ready = Boolean(userId && to && body.trim() && !busy && (internal || availability?.state !== "unavailable"));
  const send = async () => {
    if (!ready || !to || sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      // The existing endpoint resolves and validates the authenticated broker's
      // sender. Never pass a selected broker or a browser-supplied sender.
      submission.current = getSmsSubmission(submission.current, { to, body });
      const { data, error } = await supabase.functions.invoke("pp-ns-sms", {
        body: { action: "send", to, message: body.trim(), idempotency_key: submission.current.idempotencyKey },
      });
      if (error || data?.error || data?.ok !== true) throw new Error(error?.message ?? data?.error ?? tr("Envoi non confirmé.", "Submission not confirmed."));
      toast.success(tr("Message accepté", "Message accepted"));
      setBody("");
      submission.current = null;
      onSent();
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : tr("Envoi non confirmé.", "Submission not confirmed."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const content = <>
      {!inline && <DialogHeader>
        <DialogTitle>{tr("Nouveau texto", "New text message")}</DialogTitle>
        <DialogDescription>{internal ? tr(`Message interne — poste ${to}`, `Internal message — extension ${to}`) : availability?.primaryNumber ? tr(`De : ${availability.primaryNumber}`, `From: ${availability.primaryNumber}`) : tr("Votre ligne de courtier", "Your broker line")}</DialogDescription>
      </DialogHeader>}
      {!inline && <div className="grid gap-2">
        <label htmlFor="portal-sms-recipient" className="text-sm font-medium">{tr("Destinataire", "Recipient")}</label>
        <Input id="portal-sms-recipient" className="min-w-0 text-foreground" autoComplete="off" value={recipient} disabled={busy} onFocus={() => setPickerOpen(true)} onChange={(e) => { setRecipient(e.target.value); setSelected(null); setPickerOpen(true); }} placeholder={tr("Nom, poste ou numéro de téléphone", "Name, extension or phone number")} />
        {selected && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Check className="h-4 w-4 text-primary" /><span>{selected.name} · {selected.number}</span></div>}
        {pickerOpen && <div className="rounded-md border border-input bg-background">
          {contactsLoading && <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tr("Chargement des destinataires…", "Loading recipients…")}</p>}
          <div className="max-h-44 overflow-y-auto" role="group" aria-label={tr("Destinataires", "Recipients")}>
            {matches.map((contact) => <Button key={`${contact.name}|${contact.number}`} variant="ghost" disabled={busy} className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-left" onClick={() => { setRecipient(contact.number); setSelected(contact); setPickerOpen(false); }}>
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block whitespace-normal break-words font-medium">{contact.name}</span><span className="block text-xs text-muted-foreground">{contact.number}</span></span>
            </Button>)}
          </div>
          {!contactsLoading && !matches.length && <p className="p-3 text-sm text-muted-foreground">{tr("Aucun destinataire trouvé", "No recipients found")}</p>}
          {contactsError && <p role="status" className="border-t border-input p-3 text-sm text-muted-foreground">{tr("Certains contacts sont indisponibles. Vous pouvez saisir un numéro ou un poste.", "Some contacts are unavailable. You can enter a number or extension.")}</p>}
        </div>}
        {recipient.trim() && !to && <p className="text-sm text-muted-foreground">{tr("Sélectionnez un contact ou entrez un numéro valide.", "Select a contact or enter a valid number.")}</p>}
      </div>}
      <label className="grid gap-2 text-sm font-medium">{inline ? tr("Répondre", "Reply") : "Message"}
        <Textarea className={`w-full min-w-0 resize-y text-foreground ${inline ? "min-h-20 max-h-40" : "min-h-32"}`} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} placeholder={inline ? tr("Votre réponse…", "Your reply…") : tr("Votre message…", "Your message…")} />
      </label>
      {!internal && availability?.state === "unavailable" && <p role="alert" className="text-sm text-destructive">{tr("Aucun numéro SMS actif pour votre poste.", "No active SMS number for your extension.")}</p>}
      {failure && <p role="alert" className="text-sm text-destructive break-words">{failure}</p>}
      <div className={`flex justify-end gap-2 ${inline ? "" : "border-t border-border pt-4"}`}>
        {!inline && <Button variant="outline" disabled={busy} onClick={onClose}>{tr("Annuler", "Cancel")}</Button>}
        <Button disabled={!ready} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" /> : <Send />}{tr("Envoyer", "Send")}</Button>
      </div>
    </>;
  if (inline) return <div className="grid shrink-0 gap-3 border-t border-border bg-background p-3 text-foreground" aria-label={tr("Réponse à la conversation", "Conversation reply")}>{content}</div>;
  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-y-auto text-foreground" onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}>
      {content}
    </DialogContent>
  </Dialog>;
}