import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LEMTEL_ONBOARDING_ENABLED, LemtelError, portalApi, type PortalArchivedOrganization } from "./lemtelHostedApi";
import type { LemtelDict } from "./lemtelI18n";

/** Platform administrators only: archived organizations and their restoration. Hidden for everyone else. */
export function ArchivedOrganizations({ t, readonly, onRestored }: { t: LemtelDict; readonly: boolean; onRestored: () => void }) {
  const [items, setItems] = useState<PortalArchivedOrganization[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setItems((await portalApi.listArchivedOrganizations()).organizations); }
    catch { setItems(null); }
  }, []);
  useEffect(() => { if (!readonly) void load(); }, [load, readonly]);
  if (!items || items.length === 0) return null;
  const restore = async (organization: PortalArchivedOrganization) => {
    if (!window.confirm(t.archived.confirmRestore)) return;
    setBusy(organization.id);
    try { await portalApi.restoreOrganization(organization.id); toast.success(t.archived.restored); await load(); onRestored(); }
    catch (error) { toast.error(t.errors[error instanceof LemtelError ? error.key : "generic"]); }
    finally { setBusy(null); }
  };
  return <section className="mt-8"><h2 className="font-semibold mb-1">{t.archived.title}</h2><p className="lt-ink-2 text-sm mb-4">{t.archived.subtitle}</p>
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{items.map((organization) => <div key={organization.id} className="lt-card p-5 flex items-start justify-between gap-3"><div><div className="font-semibold">{organization.displayName}</div><div className="lt-ink-2 text-xs font-mono">{organization.slug}</div><span className="lt-chip mt-2 inline-block">{t.archived.badge}</span></div>
      <button className="lt-btn lt-btn-ghost !py-1.5" disabled={readonly || !LEMTEL_ONBOARDING_ENABLED || busy === organization.id} onClick={() => restore(organization)}>{busy === organization.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />}{t.archived.restore}</button></div>)}</div></section>;
}
