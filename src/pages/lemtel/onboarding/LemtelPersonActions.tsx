import { useEffect, useState } from "react";
import { KeyRound, Loader2, PauseCircle, PlayCircle, Save, Settings2, Trash2, Voicemail } from "lucide-react";
import { toast } from "sonner";
import { LEMTEL_ONBOARDING_ENABLED, LemtelError, portalApi, type LemtelLocale, type PortalPerson } from "./lemtelHostedApi";
import type { LemtelDict } from "./lemtelI18n";
import { Field, Panel } from "./LemtelUi";

const errorText = (t: LemtelDict, error: unknown) => t.errors[error instanceof LemtelError ? error.key : "generic"];

/** Row button + side panel with every administrative action on one person of the selected organization. */
export function PersonActionsButton({ t, organizationId, person, readonly, onDone }: {
  t: LemtelDict;
  organizationId: string;
  person: PortalPerson;
  readonly: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="lt-btn lt-btn-ghost !py-1.5" disabled={readonly || !LEMTEL_ONBOARDING_ENABLED} onClick={() => setOpen(true)}><Settings2 className="w-4 h-4" />{t.personActions.manage}</button>
    {open ? <PersonActionsPanel t={t} organizationId={organizationId} person={person} onClose={() => setOpen(false)} onDone={onDone} /> : null}
  </>;
}

export function PersonActionsPanel({ t, organizationId, person, onClose, onDone }: {
  t: LemtelDict;
  organizationId: string;
  person: PortalPerson;
  onClose: () => void;
  onDone: () => void;
}) {
  const a = t.personActions;
  const [fullName, setFullName] = useState(person.fullName);
  const [locale, setLocale] = useState<LemtelLocale>(person.locale);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setFullName(person.fullName); setLocale(person.locale); }, [person]);
  const isOwner = person.role === "owner";
  const run = async (key: string, confirmText: string | null, action: () => Promise<string>) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    try { toast.success(await action()); onDone(); }
    catch (error) { toast.error(errorText(t, error)); }
    finally { setBusy(null); }
  };
  const spinner = (key: string, icon: JSX.Element) => busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : icon;
  const nameValid = fullName.trim().length > 0 && fullName.trim().length <= 120;
  return <Panel open onClose={onClose} title={a.title} side footer={<button className="lt-btn lt-btn-ghost" onClick={onClose}>{t.cancel}</button>}>
    <div className="space-y-6">
      <div>
        <div className="font-semibold">{person.fullName}</div>
        <div className="lt-ink-2 text-sm break-all">{person.email}</div>
        <div className="mt-2 flex flex-wrap gap-2"><span className="lt-chip">{t.roles[person.role as keyof typeof t.roles] ?? person.role}</span><span className={`lt-chip ${person.status === "active" ? "lt-chip-ok" : "lt-chip-bad"}`}>{person.status === "active" ? a.active : a.suspended}</span></div>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm">{a.profile}</h3>
        <Field label={a.fullName} error={!nameValid ? t.errors.invalid_input : undefined}>{(id) => <input id={id} className="lt-input" value={fullName} maxLength={120} onChange={(event) => setFullName(event.target.value)} />}</Field>
        <Field label={a.language}>{(id) => <select id={id} className="lt-input" value={locale} onChange={(event) => setLocale(event.target.value as LemtelLocale)}><option value="fr">Français</option><option value="en">English</option></select>}</Field>
        <button className="lt-btn lt-btn-gold" disabled={!!busy || !nameValid || (fullName.trim() === person.fullName && locale === person.locale)}
          onClick={() => run("profile", null, async () => { await portalApi.updateMemberProfile(organizationId, person.userId, { fullName: fullName.trim(), locale }); return a.profileSaved; })}>
          {spinner("profile", <Save className="w-4 h-4" />)}{a.saveProfile}</button>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm">{a.access}</h3>
        <p className="lt-ink-2 text-xs">{a.sendPasswordHint}</p>
        <button className="lt-btn lt-btn-ghost w-full justify-start" disabled={!!busy || person.status !== "active"}
          onClick={() => run("password", a.confirmSendPassword, async () => {
            const result = await portalApi.issueTemporaryPassword(organizationId, person.userId, locale);
            if (result.deliveryStatus !== "provider_accepted") throw new LemtelError("unavailable");
            return a.passwordSent;
          })}>{spinner("password", <KeyRound className="w-4 h-4" />)}{a.sendPassword}</button>
        {person.status === "active"
          ? <button className="lt-btn lt-btn-ghost w-full justify-start" disabled={!!busy || isOwner}
              onClick={() => run("suspend", a.confirmSuspend, async () => { await portalApi.revokeAccess(organizationId, person.userId); return a.suspendedDone; })}>{spinner("suspend", <PauseCircle className="w-4 h-4" />)}{a.suspend}</button>
          : <button className="lt-btn lt-btn-ghost w-full justify-start" disabled={!!busy}
              onClick={() => run("restore", null, async () => { await portalApi.restoreMember(organizationId, person.userId); return a.restored; })}>{spinner("restore", <PlayCircle className="w-4 h-4" />)}{a.restore}</button>}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm">{a.telephony}</h3>
        <button className="lt-btn lt-btn-ghost w-full justify-start" disabled title={a.voicemailPending}><Voicemail className="w-4 h-4" />{a.voicemailReset}</button>
        <p className="lt-ink-2 text-xs">{a.voicemailPending}</p>
      </section>

      <section className="space-y-3 pt-4 border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
        <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--lt-danger))" }}>{a.danger}</h3>
        {isOwner ? <p className="lt-ink-2 text-xs">{t.errors.owner_protected}</p> : null}
        <button className="lt-btn lt-btn-danger w-full justify-start" disabled={!!busy || isOwner}
          onClick={() => run("remove", a.confirmRemove, async () => { await portalApi.removeMember(organizationId, person.userId); onClose(); return a.removed; })}>{spinner("remove", <Trash2 className="w-4 h-4" />)}{a.remove}</button>
      </section>
    </div>
  </Panel>;
}
