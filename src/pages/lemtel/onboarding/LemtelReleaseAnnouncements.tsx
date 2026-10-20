import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { LemtelError, releaseApi, type ReleaseStatus } from "./lemtelHostedApi";

/**
 * Platform administrators: the newest desktop release (resolved by the server from GitHub) and the history of
 * "new version" emails. Each release is announced automatically by the release workflow; the button only
 * resumes or replays that same server action (one email per user per version, never twice).
 */
export default function LemtelReleaseAnnouncements({ lang, readonly }: { lang: "fr" | "en"; readonly: boolean }) {
  const fr = lang === "fr";
  const [status, setStatus] = useState<ReleaseStatus | null | "hidden">(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try { setStatus(await releaseApi.status()); }
    catch (error) { setStatus(error instanceof LemtelError && error.key === "not_allowed" ? "hidden" : null); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (status === "hidden") return null;
  const latest = status?.latest;
  const current = status && latest ? status.history.find((h) => h.version === latest.version) : undefined;
  const stateLabel = (s: string) => ({
    baseline: fr ? "Référence (non annoncée)" : "Baseline (not announced)", sending: fr ? "Envoi en cours" : "Sending",
    partial: fr ? "Partiel — à reprendre" : "Partial — resume", sent: fr ? "Envoyée" : "Sent",
  } as Record<string, string>)[s] ?? s;
  const announce = async () => {
    if (!latest || !window.confirm(fr ? `Envoyer le courriel « nouvelle version ${latest.version} » à tous les utilisateurs actifs qui ne l’ont pas encore reçu ?` : `Email "new version ${latest.version}" to every active user who has not received it yet?`)) return;
    setBusy(true);
    try {
      const r = await releaseApi.announce();
      const msg: Record<string, string> = {
        sent: fr ? "Annonce envoyée." : "Announcement sent.", partial: fr ? "Envoi partiel : relancez pour terminer." : "Partially sent: run again to finish.",
        already_announced: fr ? "Cette version a déjà été annoncée." : "This version was already announced.", in_progress: fr ? "Un envoi est déjà en cours." : "A run is already in progress.",
        no_complete_release: fr ? "Aucune version complète publiée." : "No complete release is published.", older_than_announced: fr ? "Une version plus récente a déjà été annoncée." : "A newer version was already announced.",
      };
      toast.success(msg[r.status] ?? r.status);
      await reload();
    } catch (error) { toast.error(error instanceof LemtelError && error.key === "unavailable" ? (fr ? "Envoi de courriels indisponible." : "Email delivery unavailable.") : (fr ? "Action refusée." : "Action refused.")); }
    finally { setBusy(false); }
  };
  return <section className="lt-card p-6 mt-5" aria-label={fr ? "Annonces des nouvelles versions" : "New version announcements"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Megaphone className="w-5 h-5" /><h2 className="font-semibold">{fr ? "Nouvelles versions pour ordinateur" : "New desktop versions"}</h2></div>
        <p className="lt-ink-2 text-xs mt-1 max-w-2xl">{fr
          ? "Les liens de téléchargement du portail et des courriels suivent automatiquement la dernière version publiée. À chaque nouvelle version, chaque utilisateur actif reçoit un courriel dans sa langue (une seule fois)."
          : "Portal and email download links follow the newest published release automatically. For each new release, every active user receives one email in their language (once)."}</p>
      </div>
      <div className="flex gap-2">
        <button className="lt-btn lt-btn-ghost" onClick={() => void reload()} aria-label={fr ? "Actualiser" : "Refresh"}><RefreshCw className="w-4 h-4" /></button>
        <button className="lt-btn lt-btn-gold" disabled={readonly || busy || !latest || latest.source !== "github_latest" || current?.state === "sent" || current?.state === "baseline"} onClick={() => void announce()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}{current?.state === "partial" ? (fr ? "Reprendre l’envoi" : "Resume sending") : (fr ? "Annoncer maintenant" : "Announce now")}
        </button>
      </div>
    </div>
    {!status ? <p className="lt-ink-2 text-sm mt-4">{fr ? "État indisponible." : "Status unavailable."}</p> : <>
      <div className="mt-4 flex flex-wrap gap-2 items-center text-sm">
        <span className="lt-chip lt-chip-cyan">{fr ? "Dernière version" : "Latest version"} {status.latest.version}</span>
        {status.latest.source === "pinned" ? <span className="lt-chip lt-chip-warn">{fr ? "GitHub injoignable — version de secours" : "GitHub unreachable — fallback version"}</span> : null}
        <a className="text-xs underline lt-ink-2" href={status.latest.releaseUrl} target="_blank" rel="noreferrer">{fr ? "Notes de version" : "Release notes"}</a>
      </div>
      <div className="overflow-x-auto mt-4"><table className="w-full text-sm"><thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-2">Version</th><th className="p-2">{fr ? "État" : "State"}</th><th className="p-2">{fr ? "Destinataires" : "Recipients"}</th><th className="p-2">{fr ? "Acceptés" : "Accepted"}</th><th className="p-2">{fr ? "Échecs" : "Failed"}</th><th className="p-2">{fr ? "Date" : "Date"}</th></tr></thead>
        <tbody>{status.history.map((h) => <tr key={h.version} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
          <td className="p-2 font-medium tabular-nums">{h.version}</td>
          <td className="p-2"><span className={`lt-chip ${h.state === "sent" ? "lt-chip-ok" : h.state === "partial" ? "lt-chip-warn" : ""}`}>{stateLabel(h.state)}</span></td>
          <td className="p-2 tabular-nums">{h.state === "baseline" ? "—" : h.recipients}</td><td className="p-2 tabular-nums">{h.state === "baseline" ? "—" : h.accepted}</td><td className="p-2 tabular-nums">{h.state === "baseline" ? "—" : h.failed}</td>
          <td className="p-2 lt-ink-2">{new Date(h.completedAt ?? h.createdAt).toLocaleString(fr ? "fr-CA" : "en-CA")}</td>
        </tr>)}</tbody></table></div>
    </>}
  </section>;
}
