import { useCallback, useEffect, useMemo, useState } from "react";
import { PlugZap } from "lucide-react";
import LemtelPbxResourceManager from "./LemtelPbxResourceManager";
import { LemtelPbxCallHistory, LemtelPbxStats } from "./LemtelPbxCdr";
import { LemtelPbxLiveCalls, LemtelPbxManagementStatus, LemtelPbxRegistrations } from "./LemtelPbxLive";
import { pbxGateway, PbxGatewayError, type Capabilities } from "./lemtelPbxGatewayApi";
import { errorMessage, L, resourceLabel, type Lang } from "./lemtelPbxLabels";

export type WorkspaceSection = "overview" | "inventory" | "routing" | "call-center" | "analytics" | "communications" | "monitoring" | "administration";
const SECTION_RESOURCES: Record<string, { domain: string[]; platform?: string[] }> = {
  inventory: { domain: ["extensions", "voicemails", "devices", "pbx_users", "dialplans"], platform: ["gateways", "sip_profiles", "domains"] },
  routing: { domain: ["destinations", "ivr_menus", "ring_groups", "time_conditions", "call_flows"] },
  "call-center": { domain: ["call_center_queues", "call_center_agents", "conferences", "music_on_hold"] },
};

/** Live FusionPBX workspace for one telephony section, shown once the organization's management connection is configured. */
export default function LemtelPbxWorkspace({ lang, organizationId, section, readonly, onCapabilities }: { lang: Lang; organizationId: string; section: WorkspaceSection; readonly: boolean; onCapabilities?: (c: Capabilities | null) => void }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("");
  const load = useCallback(async () => {
    setError(null);
    try { const c = await pbxGateway.capabilities(organizationId); setCaps(c); onCapabilities?.(c); }
    catch (e) { setCaps(null); onCapabilities?.(null); setError(errorMessage(lang, e instanceof PbxGatewayError ? e.code : "server_error")); }
  }, [lang, onCapabilities, organizationId]);
  useEffect(() => { void load(); }, [load]);

  const isPlatform = caps?.role === "platform";
  const isAdmin = Boolean(caps && caps.role !== "member");
  const tabs = useMemo(() => {
    if (section === "analytics") return [["history", L(lang, "Historique des appels", "Call history")], ["stats", L(lang, "Statistiques", "Statistics")], ["recordings", L(lang, "Enregistrements", "Recordings")]] as Array<[string, string]>;
    if (section === "monitoring") return [["live", L(lang, "Appels en cours", "Live calls")], ["registrations", L(lang, "Appareils enregistrés", "Registered devices")]] as Array<[string, string]>;
    const r = SECTION_RESOURCES[section];
    if (!r || !caps) return [];
    const keys = [...r.domain, ...(isPlatform ? r.platform ?? [] : [])].filter((k) => caps.catalog.some((c) => c.key === k));
    return keys.map((k) => [k, resourceLabel(lang, k)] as [string, string]);
  }, [caps, isPlatform, lang, section]);
  useEffect(() => { setTab((t) => (tabs.some(([k]) => k === t) ? t : tabs[0]?.[0] ?? "")); }, [tabs]);

  if (error) return <div className="lt-card p-5 mb-6 text-sm" role="status"><PlugZap className="w-4 h-4 inline mr-1" />{error}</div>;
  if (!caps) return <div className="lt-skeleton h-24 mb-6" />;
  if (!caps.managementReady) return <div className="lt-card p-5 mb-6 text-sm" role="status"><PlugZap className="w-4 h-4 inline mr-1" />
    <b>{L(lang, "Connexion FusionPBX requise.", "FusionPBX connection required.")}</b> {L(lang, "Dans « Vue d’ensemble », choisissez « API FusionPBX », saisissez l’URL, le domain_uuid de cette organisation, l’utilisateur API et la clé API reçus de Kenny et Phil. Tous les modules ci-dessous s’activent alors automatiquement.", "In “Overview”, choose “FusionPBX API”, enter the URL, this organization’s domain_uuid, the API user and the API key received from Kenny and Phil. Every module below then activates automatically.")}</div>;
  if (!isAdmin) return <div className="lt-card p-5 mb-6 text-sm">{L(lang, "Votre espace personnel est dans « Mon espace ».", "Your personal space is under “My space”.")}</div>;
  const canWrite = caps.writesEnabled && !readonly;

  if (section === "overview" || section === "administration") return <div className="mb-6"><LemtelPbxManagementStatus lang={lang} organizationId={organizationId} caps={caps} readonly={readonly} onChanged={() => void load()} /></div>;
  if (section === "communications") return null;

  const tabBar = tabs.length > 1 && <div className="flex flex-wrap gap-2 mb-4" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={`lt-btn !py-1.5 ${tab === k ? "lt-btn-gold" : "lt-btn-ghost"}`} onClick={() => setTab(k)}>{label}</button>)}</div>;
  let body: JSX.Element | null = null;
  if (section === "analytics") body = tab === "stats" ? <LemtelPbxStats lang={lang} organizationId={organizationId} /> : <LemtelPbxCallHistory key={tab} lang={lang} organizationId={organizationId} recordedOnly={tab === "recordings"} />;
  else if (section === "monitoring") body = tab === "registrations" ? <LemtelPbxRegistrations lang={lang} organizationId={organizationId} /> : <LemtelPbxLiveCalls lang={lang} organizationId={organizationId} canAct={canWrite} />;
  else {
    const entry = caps.catalog.find((c) => c.key === tab);
    body = entry ? <LemtelPbxResourceManager key={entry.key} lang={lang} organizationId={organizationId} entry={entry} catalog={caps.catalog} writesEnabled={caps.writesEnabled} readonly={readonly} isPlatform={isPlatform} /> : null;
  }
  return <div className="mb-6">{!caps.writesEnabled && <p className="lt-notice p-3 text-sm mb-4">{errorMessage(lang, "management_writes_disabled")}</p>}{tabBar}{body}</div>;
}
