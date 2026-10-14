import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { LEMTEL_ONBOARDING_ENABLED, LemtelError, portalApi, type AssignableRole, type PortalPerson } from "./lemtelHostedApi";
import type { LemtelDict } from "./lemtelI18n";
import { Field, Panel } from "./LemtelUi";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const errorText = (t: LemtelDict, error: unknown) => t.errors[error instanceof LemtelError ? error.key : "generic"];

/** Assigns an existing Lemtel identity to the selected organization without creating credentials or sending email. */
export function AssignExistingMemberDialog({ open, onClose, t, organizationId, onDone }: {
  open: boolean;
  onClose: () => void;
  t: LemtelDict;
  organizationId: string | null;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("member");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setEmail(""); setRole("member"); setTouched(false); setError(null); onClose(); };
  const submit = async () => {
    setTouched(true);
    if (!organizationId || !EMAIL_RE.test(email.trim())) return;
    setBusy(true); setError(null);
    try {
      await portalApi.assignExistingUser(organizationId, { email, role });
      toast.success(t.membership.assigned);
      onDone(); close();
    } catch (cause) { setError(errorText(t, cause)); }
    finally { setBusy(false); }
  };
  return <Panel open={open} onClose={close} title={t.membership.assignTitle} side footer={<><button className="lt-btn lt-btn-ghost" onClick={close}>{t.cancel}</button><button className="lt-btn lt-btn-gold" disabled={busy || !organizationId || !LEMTEL_ONBOARDING_ENABLED} onClick={submit}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{t.membership.assign}</button></>}>
    <div className="space-y-4">
      <p className="lt-ink-2 text-sm">{t.membership.assignSubtitle}</p>
      <Field label={t.email} error={touched && !EMAIL_RE.test(email.trim()) ? t.errors.invalid_input : undefined}>{(id) => <input id={id} className="lt-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>
      <Field label={t.role}>{(id) => <select id={id} className="lt-input" value={role} onChange={(event) => setRole(event.target.value as AssignableRole)}><option value="member">{t.roles.member}</option><option value="admin">{t.roles.admin}</option></select>}</Field>
      <p className="lt-notice px-3 py-2 text-xs">{t.membership.assignNotice}</p>
      {error ? <p className="lt-error" role="alert">{error}</p> : null}
    </div>
  </Panel>;
}

/** Keeps owner membership immutable here; role updates always go through the server and authority revision. */
export function MembershipRoleControl({ t, organizationId, person, readonly, onDone }: {
  t: LemtelDict;
  organizationId: string | null;
  person: PortalPerson;
  readonly: boolean;
  onDone: () => void;
}) {
  const [role, setRole] = useState<AssignableRole>(person.role === "admin" ? "admin" : "member");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole(person.role === "admin" ? "admin" : "member"); }, [person.role]);
  if (person.role === "owner") return <span className="lt-chip">{t.roles.owner}</span>;
  const save = async () => {
    if (!organizationId || role === person.role) return;
    setBusy(true);
    try { await portalApi.setMembershipRole(organizationId, person.userId, role); toast.success(t.membership.roleUpdated); onDone(); }
    catch (cause) { toast.error(errorText(t, cause)); }
    finally { setBusy(false); }
  };
  const transferOwnership = async () => {
    if (!organizationId || !window.confirm(t.membership.confirmOwnershipTransfer)) return;
    setBusy(true);
    try { await portalApi.transferOrganizationOwnership(organizationId, person.userId); toast.success(t.membership.ownershipTransferred); onDone(); }
    catch (cause) { toast.error(errorText(t, cause)); }
    finally { setBusy(false); }
  };
  return <div className="flex items-center gap-2 min-w-[180px] flex-wrap"><select aria-label={t.role} className="lt-input !py-1.5 text-xs" disabled={readonly || busy || !organizationId} value={role} onChange={(event) => setRole(event.target.value as AssignableRole)}><option value="member">{t.roles.member}</option><option value="admin">{t.roles.admin}</option></select><button className="lt-btn lt-btn-ghost !py-1.5 !px-2" aria-label={t.membership.saveRole} disabled={readonly || busy || !organizationId || role === person.role} onClick={save}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</button><button className="lt-btn lt-btn-ghost !py-1.5 text-xs" disabled={readonly || busy || !organizationId} onClick={transferOwnership}>{t.membership.transferOwnership}</button></div>;
}
