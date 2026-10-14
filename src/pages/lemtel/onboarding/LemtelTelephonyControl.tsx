import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { LemtelError, portalApi, type PortalTelephonyCapability } from "./lemtelHostedApi";

type Props = { lang: "fr" | "en"; organizationId: string | null; readonly: boolean };

type Copy = {
  title: string;
  subtitle: string;
  chooseOrganization: string;
  loading: string;
  refresh: string;
  serverAuthority: string;
  providerRuntime: string;
  activationGate: string;
  ready: string;
  notProvisioned: string;
  pending: string;
  noCapability: string;
  requirement: string;
  disclosure: string;
  activationRule: string;
};

const COPY: Record<Props["lang"], Copy> = {
  fr: {
    title: "Contrôle téléphonie",
    subtitle: "Inventaire d’administration Lemtel isolé — aucun PBX, SIP, appel, enregistrement ou message n’est simulé.",
    chooseOrganization: "Choisissez une organisation pour consulter la préparation téléphonie autorisée par le serveur.",
    loading: "Chargement de l’état de préparation…",
    refresh: "Actualiser l’état",
    serverAuthority: "Autorité serveur",
    providerRuntime: "Runtime téléphonie",
    activationGate: "Porte d’activation",
    ready: "Prêt côté portail",
    notProvisioned: "Non provisionné",
    pending: "Informations Kenny/Phil et prévol requis",
    noCapability: "Aucune capacité déclarée.",
    requirement: "Pré-requis d’activation",
    disclosure: "Les éléments ci-dessous sont des contrôles de gestion préparés pour Lemtel. Ils restent inactifs jusqu’à la validation explicite des informations fournisseur, des secrets côté serveur, de l’isolation organisationnelle et des tests réels.",
    activationRule: "Aucune connexion PBX/SIP/WSS/TURN, aucun appel, aucun SMS, aucun accès média et aucune écriture fournisseur n’est déclenché depuis ce portail.",
  },
  en: {
    title: "Telephony control",
    subtitle: "Isolated Lemtel administration inventory — no PBX, SIP, call, recording, or message is simulated.",
    chooseOrganization: "Select an organization to view the server-authorized telephony readiness state.",
    loading: "Loading readiness state…",
    refresh: "Refresh state",
    serverAuthority: "Server authority",
    providerRuntime: "Telephony runtime",
    activationGate: "Activation gate",
    ready: "Portal ready",
    notProvisioned: "Not provisioned",
    pending: "Kenny/Phil inputs and preflight required",
    noCapability: "No declared capability.",
    requirement: "Activation prerequisites",
    disclosure: "The controls below are Lemtel management capabilities prepared for activation. They remain inactive until provider information, server-side secrets, organization isolation, and real-world tests are explicitly approved.",
    activationRule: "This portal does not initiate a PBX/SIP/WSS/TURN connection, call, SMS, media access, or provider-side write.",
  },
};

const CATEGORY_ORDER = ["phone_system", "call_center", "analytics_media", "communications", "monitoring", "administration"] as const;

export default function LemtelTelephonyControl({ lang, organizationId, readonly }: Props) {
  const copy = COPY[lang];
  const [items, setItems] = useState<PortalTelephonyCapability[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!organizationId || readonly) { setItems([]); return; }
    setRefreshing(true);
    try {
      const response = await portalApi.getTelephonyReadiness(organizationId);
      setItems(response.capabilities);
    } catch (error) {
      setItems([]);
      toast.error(error instanceof LemtelError ? (lang === "fr" ? "État téléphonie indisponible." : "Telephony state is unavailable.") : (lang === "fr" ? "Erreur de chargement." : "Unable to load the control plane."));
    } finally {
      setRefreshing(false);
    }
  }, [lang, organizationId, readonly]);

  useEffect(() => { void refresh(); }, [refresh]);

  const sections = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    items: (items ?? []).filter((item) => item.category === category),
  })).filter((section) => section.items.length), [items]);

  if (!organizationId) return <section><h1 className="lt-page-heading font-semibold mb-2">{copy.title}</h1><p className="lt-ink-2 text-sm mb-6">{copy.subtitle}</p><div className="lt-card p-6 text-sm lt-ink-2">{copy.chooseOrganization}</div></section>;

  const total = items?.length ?? 0;
  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6"><div><h1 className="lt-page-heading font-semibold">{copy.title}</h1><p className="lt-ink-2 text-sm mt-1">{copy.subtitle}</p></div><button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={readonly || refreshing}><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />{copy.refresh}</button></div>

    <div className="grid md:grid-cols-3 gap-4 mb-6">
      <div className="lt-card p-5"><ShieldCheck className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-cyan))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.serverAuthority}</div><div className="font-semibold mt-1">{copy.ready}</div></div>
      <div className="lt-card p-5"><CircleAlert className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-gold))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.providerRuntime}</div><div className="font-semibold mt-1">{copy.notProvisioned}</div></div>
      <div className="lt-card p-5"><CheckCircle2 className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-gold))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.activationGate}</div><div className="font-semibold mt-1">{copy.pending}</div></div>
    </div>

    <div className="lt-notice p-4 mb-6 text-sm"><p className="font-semibold">{copy.activationRule}</p><p className="mt-1">{copy.disclosure}</p></div>

    {items === null ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.loading}</div> : total === 0 ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.noCapability}</div> : <div className="space-y-5">
      {sections.map((section) => <section key={section.category} className="lt-card overflow-hidden"><div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: "hsl(var(--lt-border))" }}><h2 className="font-semibold">{lang === "fr" ? section.items[0].categoryFr : section.items[0].categoryEn}</h2><span className="lt-chip lt-chip-warn">{section.items.length}</span></div><div className="divide-y" style={{ borderColor: "hsl(var(--lt-border))" }}>{section.items.map((item) => <article key={item.key} className="p-5 grid lg:grid-cols-[minmax(0,1fr)_minmax(240px,.75fr)] gap-4"><div><h3 className="font-semibold">{lang === "fr" ? item.nameFr : item.nameEn}</h3><p className="lt-ink-2 text-sm mt-1">{lang === "fr" ? item.descriptionFr : item.descriptionEn}</p></div><div className="flex flex-col items-start lg:items-end gap-2"><span className="lt-chip lt-chip-warn">{copy.notProvisioned}</span><p className="lt-ink-2 text-xs text-left lg:text-right"><strong>{copy.requirement}:</strong> {lang === "fr" ? item.activationRequirementFr : item.activationRequirementEn}</p></div></article>)}</div></section>)}
    </div>}
  </section>;
}
