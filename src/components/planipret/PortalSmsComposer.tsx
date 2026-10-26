import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSmsAvailability, type SmsAvailability } from "@/lib/planipret/smsAvailability";
import { isInternalMessageRecipient, normalizePortalMessageRecipient } from "@/lib/planipret/portalMessageRecipient";
import { getSmsSubmission, type SmsSubmission } from "@/lib/planipret/smsSendGuard";

export default function PortalSmsComposer({ target, userId, lang, onClose, onSent }: {
  target: { number: string } | null;
  userId: string;
  lang: "en" | "fr";
  onClose: () => void;
  onSent: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [availability, setAvailability] = useState<SmsAvailability | null>(null);
  const submission = useRef<SmsSubmission | null>(null);
  const sending = useRef(false);
  const tr = (fr: string, en: string) => lang === "en" ? en : fr;

  useEffect(() => {
    let current = true;
    setRecipient(target?.number ?? "");
    setBody("");
    setFailure(null);
    setAvailability(null);
    submission.current = null;
    if (target && userId) void getSmsAvailability(true).then((value) => { if (current) setAvailability(value); });
    return () => { current = false; };
  }, [target, userId]);

  const to = normalizePortalMessageRecipient(recipient);
  const internal = isInternalMessageRecipient(recipient);
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
      onSent();
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : tr("Envoi non confirmé.", "Submission not confirmed."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{tr("Nouveau texto", "New text message")}</DialogTitle>
        <DialogDescription>{internal ? tr(`Message interne — poste ${to}`, `Internal message — extension ${to}`) : availability?.primaryNumber ? tr(`De : ${availability.primaryNumber}`, `From: ${availability.primaryNumber}`) : tr("Votre ligne de courtier", "Your broker line")}</DialogDescription>
      </DialogHeader>
      <label className="grid gap-2 text-sm">{tr("Destinataire", "Recipient")}
        <input className="pp-input w-full min-w-0" type="tel" autoComplete="tel" value={recipient} disabled={busy} onChange={(e) => setRecipient(e.target.value)} placeholder={tr("Poste ou numéro +1 …", "Extension or +1 number …")} />
      </label>
      <label className="grid gap-2 text-sm">Message
        <textarea className="pp-input w-full min-w-0 min-h-32 resize-y" value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
      </label>
      {!internal && availability?.state === "unavailable" && <p role="alert" className="text-sm text-destructive">{tr("Aucun numéro SMS actif pour votre poste.", "No active SMS number for your extension.")}</p>}
      {failure && <p role="alert" className="text-sm text-destructive break-words">{failure}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{tr("Annuler", "Cancel")}</Button>
        <Button disabled={!ready} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" /> : <Send />}{tr("Envoyer", "Send")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}