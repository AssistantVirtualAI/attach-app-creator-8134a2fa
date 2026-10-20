import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Phone, PhoneForwarded, RefreshCw, Trash2, Voicemail } from "lucide-react";
import { toast } from "sonner";
import { LemtelPbxCallHistory } from "./LemtelPbxCdr";
import { pbxGateway, PbxGatewayError, type SelfOverview } from "./lemtelPbxGatewayApi";
import { errorMessage, fieldLabel, formatSeconds, L, type Lang } from "./lemtelPbxLabels";

const err = (lang: Lang, e: unknown) => errorMessage(lang, e instanceof PbxGatewayError ? e.code : "server_error");
const FORWARDS = [["forward_all_enabled", "forward_all_destination"], ["forward_busy_enabled", "forward_busy_destination"], ["forward_no_answer_enabled", "forward_no_answer_destination"],
  ["forward_user_not_registered_enabled", "forward_user_not_registered_destination"]] as const;

/** « Mon espace » — every user: their extension, call forwarding, do-not-disturb, voicemail, history, click-to-call. */
export default function LemtelMySpace({ lang, organizationId, readonly }: { lang: Lang; organizationId: string | null; readonly: boolean }) {
  const [me, setMe] = useState<SelfOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [pin, setPin] = useState("");
  const [dial, setDial] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!organizationId) return;
    setError(null);
    try {
      const r = await pbxGateway.me(organizationId);
      setMe(r);
      setForm(Object.fromEntries(Object.entries(r.forwarding).map(([k, v]) => [k, k.endsWith("_enabled") || k === "do_not_disturb" ? v === "true" : v ?? ""])));
    } catch (e) { setMe(null); setError(err(lang, e)); }
  }, [lang, organizationId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); } };
  const canWrite = Boolean(me?.writesEnabled) && !readonly;
  if (!organizationId) return <div className="lt-card p-6 text-sm lt-ink-2">{L(lang, "Choisissez une organisation.", "Choose an organization.")}</div>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="lt-page-heading font-semibold">{L(lang, "Mon espace", "My space")}</h1>
      <p className="lt-ink-2 text-sm mt-1">{me ? `${L(lang, "Poste", "Extension")} ${me.extension}${me.callerIdName ? ` · ${me.callerIdName}` : ""}` : L(lang, "Votre poste, vos renvois, votre messagerie et vos appels.", "Your extension, forwarding, voicemail and calls.")}</p></div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void load()}><RefreshCw className="w-4 h-4" />{L(lang, "Actualiser", "Refresh")}</button></div>
    {error && <div className="lt-card p-5 text-sm" role="alert">{error}</div>}
    {me && <>
      {!me.writesEnabled && <p className="lt-notice p-3 text-sm">{errorMessage(lang, "management_writes_disabled")}</p>}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="lt-card p-5 space-y-3" aria-label={L(lang, "Renvois", "Forwarding")}>
          <h3 className="font-semibold"><PhoneForwarded className="w-4 h-4 inline" /> {L(lang, "Renvois et ne pas déranger", "Forwarding and do not disturb")}</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.do_not_disturb === true} disabled={!canWrite} onChange={(e) => setForm((f) => ({ ...f, do_not_disturb: e.target.checked }))} />{fieldLabel(lang, "do_not_disturb")}</label>
          {FORWARDS.map(([en, dest]) => <div key={en} className="grid grid-cols-[auto_1fr] gap-2 items-center text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form[en] === true} disabled={!canWrite} onChange={(e) => setForm((f) => ({ ...f, [en]: e.target.checked }))} />{fieldLabel(lang, en)}</label>
            <input className="lt-input !py-1.5" aria-label={fieldLabel(lang, dest)} inputMode="tel" placeholder="5145551234" value={String(form[dest] ?? "")} disabled={!canWrite} onChange={(e) => setForm((f) => ({ ...f, [dest]: e.target.value.replace(/[^0-9*#+]/g, "") }))} />
          </div>)}
          <button className="lt-btn lt-btn-gold" disabled={!canWrite || busy !== null} onClick={() => void run("fwd", () => pbxGateway.updateForwarding(organizationId, form), L(lang, "Renvois enregistrés.", "Forwarding saved."))}>{busy === "fwd" && <Loader2 className="w-4 h-4 animate-spin" />}{L(lang, "Enregistrer", "Save")}</button>
        </div>
        <div className="lt-card p-5 space-y-3" aria-label={L(lang, "Appeler", "Call")}>
          <h3 className="font-semibold"><Phone className="w-4 h-4 inline" /> {L(lang, "Appeler depuis mon poste", "Call from my extension")}</h3>
          <p className="lt-ink-2 text-xs">{L(lang, "Votre téléphone sonne d’abord, puis l’appel est lancé vers le numéro.", "Your phone rings first, then the call is placed to the number.")}</p>
          <div className="flex gap-2"><input className="lt-input" inputMode="tel" aria-label={L(lang, "Numéro à appeler", "Number to call")} value={dial} onChange={(e) => setDial(e.target.value.replace(/[^0-9*#+]/g, ""))} />
            <button className="lt-btn lt-btn-gold" disabled={!canWrite || !dial || busy !== null} onClick={() => void run("dial", () => pbxGateway.clickToCall(organizationId, dial), L(lang, "Votre poste sonne.", "Your extension is ringing."))}>{L(lang, "Appeler", "Call")}</button></div>
          <h3 className="font-semibold pt-3"><KeyRound className="w-4 h-4 inline" /> {L(lang, "NIP de messagerie vocale", "Voicemail PIN")}</h3>
          <div className="flex gap-2"><input className="lt-input" type="password" inputMode="numeric" autoComplete="new-password" aria-label={L(lang, "Nouveau NIP", "New PIN")} placeholder="4–10" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} />
            <button className="lt-btn lt-btn-ghost" disabled={!canWrite || pin.length < 4 || busy !== null} onClick={() => void run("pin", async () => { await pbxGateway.setMyVoicemailPin(organizationId, pin); setPin(""); }, L(lang, "NIP modifié.", "PIN changed."))}>{L(lang, "Changer", "Change")}</button></div>
        </div>
      </div>
      <div className="lt-card p-5" aria-label={L(lang, "Messagerie vocale", "Voicemail")}>
        <h3 className="font-semibold mb-3"><Voicemail className="w-4 h-4 inline" /> {L(lang, "Messagerie vocale", "Voicemail")} {me.voicemail ? <span className="lt-chip">{me.voicemail.messages.length}</span> : null}</h3>
        {!me.voicemail ? <p className="lt-ink-2 text-sm">{L(lang, "Aucune boîte vocale pour ce poste.", "No mailbox for this extension.")}</p> : me.voicemail.messages.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun message.", "No message.")}</p> :
          <ul className="space-y-2">{me.voicemail.messages.map((m) => <li key={m.uuid} className="flex justify-between gap-3 text-sm border-t pt-2" style={{ borderColor: "hsl(var(--lt-border))" }}>
            <div><div className="font-medium">{m.callerName || m.callerNumber || "—"} <span className="lt-ink-2">{m.callerNumber}</span></div><div className="lt-ink-2 text-xs">{m.createdAt ? new Date(m.createdAt).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA") : "—"} · {formatSeconds(m.seconds)}</div>{m.transcription && <p className="text-xs mt-1">{m.transcription}</p>}</div>
            <button className="lt-btn lt-btn-ghost !py-1" aria-label={L(lang, "Supprimer", "Delete")} disabled={!canWrite || busy !== null} onClick={() => void run(m.uuid, () => pbxGateway.deleteMyVoicemail(organizationId, m.uuid), L(lang, "Message supprimé.", "Message deleted."))}><Trash2 className="w-4 h-4" /></button></li>)}</ul>}
      </div>
      <LemtelPbxCallHistory lang={lang} organizationId={organizationId} canExport={false} canSync={false} />
    </>}
  </section>;
}
