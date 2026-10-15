import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CheckCircle2, ChevronRight, CircleAlert, Headphones, Layers3, MessageSquare, RefreshCw, Route, Settings2, ShieldCheck } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { LemtelError, portalApi, type PortalTelephonyCapability } from "./lemtelHostedApi";

type Props = { basePath: string; lang: "fr" | "en"; organizationId: string | null; readonly: boolean };
type SectionId = "overview" | "inventory" | "routing" | "call-center" | "analytics" | "communications" | "monitoring" | "administration";
type Localized = { fr: string; en: string };

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
  navigation: string;
  catalogModules: string;
  openSection: string;
  preparedOnly: string;
  sectionLabel: string;
  noModulesInSection: string;
};

const COPY: Record<Props["lang"], Copy> = {
  fr: {
    title: "Control-plane téléphonie",
    subtitle: "Navigation Lemtel isolée et multi-organisation — chaque domaine est prêt à être gouverné, sans simuler un service téléphonique.",
    chooseOrganization: "Sélectionnez une organisation dans l’en-tête pour charger uniquement son catalogue de préparation autorisé par le serveur.",
    loading: "Chargement du catalogue de préparation…",
    refresh: "Actualiser le catalogue",
    serverAuthority: "Autorité serveur",
    providerRuntime: "Runtime téléphonie",
    activationGate: "Porte d’activation",
    ready: "Prêt côté portail",
    notProvisioned: "Non provisionné",
    pending: "Informations Kenny/Phil et prévol requis",
    noCapability: "Aucun module de préparation n’est déclaré pour cette organisation.",
    requirement: "Pré-requis d’activation",
    disclosure: "Les options ci-dessous sont des surfaces de gestion Lemtel préparées pour une activation future. Elles n’établissent aucun accès PBX, SIP, WSS, TURN, média, message ou fournisseur.",
    activationRule: "La navigation et les validations de ce control-plane ne déclenchent aucune connexion, appel, SMS, lecture média, synchronisation ou écriture fournisseur.",
    navigation: "Navigation téléphonie",
    catalogModules: "modules du catalogue",
    openSection: "Ouvrir la section",
    preparedOnly: "Préparation uniquement",
    sectionLabel: "Domaine de gestion",
    noModulesInSection: "Aucun module de préparation n’est déclaré dans cette section.",
  },
  en: {
    title: "Telephony control plane",
    subtitle: "Isolated, multi-organization Lemtel navigation — every domain is ready for governance without simulating a telephony service.",
    chooseOrganization: "Select an organization in the header to load only its server-authorized preparation catalog.",
    loading: "Loading the preparation catalog…",
    refresh: "Refresh catalog",
    serverAuthority: "Server authority",
    providerRuntime: "Telephony runtime",
    activationGate: "Activation gate",
    ready: "Portal ready",
    notProvisioned: "Not provisioned",
    pending: "Kenny/Phil inputs and preflight required",
    noCapability: "No preparation module is declared for this organization.",
    requirement: "Activation prerequisites",
    disclosure: "The options below are Lemtel management surfaces prepared for future activation. They do not establish PBX, SIP, WSS, TURN, media, messaging, or provider access.",
    activationRule: "Navigation and validation in this control plane do not initiate any connection, call, SMS, media read, synchronization, or provider-side write.",
    navigation: "Telephony navigation",
    catalogModules: "catalog modules",
    openSection: "Open section",
    preparedOnly: "Preparation only",
    sectionLabel: "Management domain",
    noModulesInSection: "No preparation module is declared in this section.",
  },
};

const SECTION_LABELS: Record<SectionId, Localized> = {
  overview: { fr: "Vue d’ensemble", en: "Overview" },
  inventory: { fr: "Inventaire téléphonie", en: "Telephony inventory" },
  routing: { fr: "Routage et IVR", en: "Routing and IVR" },
  "call-center": { fr: "Centre d’appels", en: "Call center" },
  analytics: { fr: "Médias et analytique", en: "Media and analytics" },
  communications: { fr: "Communications", en: "Communications" },
  monitoring: { fr: "Supervision", en: "Monitoring" },
  administration: { fr: "Administration téléphonie", en: "Telephony administration" },
};

const SECTION_DESCRIPTIONS: Record<SectionId, Localized> = {
  overview: { fr: "Parcourez tous les domaines préparés, puis ouvrez une section dédiée.", en: "Browse every prepared domain, then open a dedicated section." },
  inventory: { fr: "Extensions, utilisateurs téléphonie, appareils, passerelles, profils, dialplans, codes et paramètres.", en: "Extensions, telephony users, devices, gateways, profiles, dialplans, codes, and settings." },
  routing: { fr: "Routes entrantes, conditions horaires, IVR, groupes de sonnerie et renvoi déclaratif.", en: "Inbound routes, time conditions, IVR, ring groups, and declarative forwarding." },
  "call-center": { fr: "Files, agents, conférences, politiques média, messagerie vocale, wallboard, console et QA.", en: "Queues, agents, conferences, media policies, voicemail, wallboard, console, and QA." },
  analytics: { fr: "Centre média, historique d’appels, enregistrements, insights IA et rapports contrôlés par rôle.", en: "Media center, call history, recordings, AI insights, and role-controlled reporting." },
  communications: { fr: "SMS, chat d’équipe et conversations d’agents, sans canal opérationnel avant admission.", en: "SMS, team chat, and agent conversations, with no operational channel before admission." },
  monitoring: { fr: "Appels actifs, registrations, état système, synchronisation et audit IA redacted.", en: "Active calls, registrations, system state, synchronization, and redacted AI audit." },
  administration: { fr: "Accès, téléchargements, politiques avancées et paramètres d’espace sous autorité Lemtel.", en: "Access, downloads, advanced policies, and workspace settings under Lemtel authority." },
};

const SECTION_KEYS: Record<Exclude<SectionId, "overview">, readonly string[]> = {
  inventory: ["extensions", "pbx_users", "devices", "gateways", "voice_gateways", "sip_profiles", "dialplans", "feature_codes", "voice_agents", "customers", "pbx_settings"],
  routing: ["inbound_routes", "time_conditions", "ivr", "ring_groups", "call_forwarding"],
  "call-center": ["queues", "queue_agents", "conferences", "music_on_hold", "recording_rules", "voicemail_settings", "wallboard", "agent_console", "call_center_admin", "telephony_qa"],
  analytics: ["media_center", "call_history", "recordings", "ai_insights", "reports"],
  communications: ["sms", "team_chat", "agent_conversations", "voicemail_settings"],
  monitoring: ["active_calls", "registrations", "system_status", "sync_health", "ai_audit"],
  administration: ["users_access", "app_downloads", "advanced_pbx", "workspace_settings"],
};

const NAVIGATION = [
  { id: "overview", icon: Layers3 },
  { id: "inventory", icon: Settings2 },
  { id: "routing", icon: Route },
  { id: "call-center", icon: Headphones },
  { id: "analytics", icon: BarChart3 },
  { id: "communications", icon: MessageSquare },
  { id: "monitoring", icon: Activity },
  { id: "administration", icon: ShieldCheck },
] as const satisfies ReadonlyArray<{ id: SectionId; icon: typeof Layers3 }>;

function labelFor(lang: Props["lang"], label: Localized) {
  return label[lang];
}

function currentSection(pathname: string, basePath: string): SectionId {
  const suffix = pathname.replace(basePath, "").replace(/^\/+|\/+$/g, "");
  return NAVIGATION.some((item) => item.id === suffix) ? suffix as SectionId : "overview";
}

function sectionItems(items: PortalTelephonyCapability[], sectionId: SectionId) {
  if (sectionId === "overview") return [];
  return items.filter((item) => SECTION_KEYS[sectionId].includes(item.key));
}

export default function LemtelTelephonyControl({ basePath, lang, organizationId, readonly }: Props) {
  const copy = COPY[lang];
  const location = useLocation();
  const activeSection = currentSection(location.pathname, basePath);
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

  const catalog = useMemo(() => items ?? [], [items]);
  const selectedItems = useMemo(() => sectionItems(catalog, activeSection), [activeSection, catalog]);
  const overview = useMemo(() => NAVIGATION.filter((item) => item.id !== "overview").map((item) => ({
    ...item,
    modules: sectionItems(catalog, item.id),
  })), [catalog]);

  const navigation = <nav className="lt-control-nav" aria-label={copy.navigation}>
    {NAVIGATION.map(({ id, icon: Icon }) => {
      const to = id === "overview" ? basePath : `${basePath}/${id}`;
      return <NavLink end={id === "overview"} key={id} to={to} className="lt-control-nav-item">
        <Icon className="w-4 h-4" aria-hidden />
        <span>{labelFor(lang, SECTION_LABELS[id])}</span>
      </NavLink>;
    })}
  </nav>;

  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <div className="flex items-center gap-2 mb-1"><span className="lt-chip lt-chip-cyan">{copy.preparedOnly}</span><span className="lt-ink-2 text-xs uppercase tracking-wide">{copy.sectionLabel}</span></div>
        <h1 className="lt-page-heading font-semibold">{activeSection === "overview" ? copy.title : labelFor(lang, SECTION_LABELS[activeSection])}</h1>
        <p className="lt-ink-2 text-sm mt-1">{activeSection === "overview" ? copy.subtitle : labelFor(lang, SECTION_DESCRIPTIONS[activeSection])}</p>
      </div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={readonly || refreshing || !organizationId}><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />{copy.refresh}</button>
    </div>

    {navigation}

    <div className="grid md:grid-cols-3 gap-4 mb-6">
      <div className="lt-card p-5"><ShieldCheck className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-cyan))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.serverAuthority}</div><div className="font-semibold mt-1">{copy.ready}</div></div>
      <div className="lt-card p-5"><CircleAlert className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-gold))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.providerRuntime}</div><div className="font-semibold mt-1">{copy.notProvisioned}</div></div>
      <div className="lt-card p-5"><CheckCircle2 className="w-5 h-5 mb-3" style={{ color: "hsl(var(--lt-gold))" }} /><div className="lt-ink-2 text-xs uppercase tracking-wide">{copy.activationGate}</div><div className="font-semibold mt-1">{copy.pending}</div></div>
    </div>

    <div className="lt-notice p-4 mb-6 text-sm"><p className="font-semibold">{copy.activationRule}</p><p className="mt-1">{copy.disclosure}</p></div>

    {!organizationId ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.chooseOrganization}</div> : items === null ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.loading}</div> : catalog.length === 0 ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.noCapability}</div> : activeSection === "overview" ? <div className="grid lg:grid-cols-2 gap-4">
      {overview.map(({ id, icon: Icon, modules }) => <NavLink key={id} to={`${basePath}/${id}`} className="lt-card lt-control-overview p-5 text-left">
        <div className="flex items-start justify-between gap-4"><div className="lt-control-icon"><Icon className="w-5 h-5" /></div><ChevronRight className="w-5 h-5 lt-ink-2" aria-hidden /></div>
        <h2 className="font-semibold mt-5">{labelFor(lang, SECTION_LABELS[id])}</h2>
        <p className="lt-ink-2 text-sm mt-1">{labelFor(lang, SECTION_DESCRIPTIONS[id])}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-5"><span className="lt-chip lt-chip-warn">{modules.length} {copy.catalogModules}</span><span className="text-sm font-semibold" style={{ color: "hsl(var(--lt-cyan))" }}>{copy.openSection}</span></div>
      </NavLink>)}
    </div> : selectedItems.length === 0 ? <div className="lt-card p-6 text-sm lt-ink-2">{copy.noModulesInSection}</div> : <div className="space-y-3">
      {selectedItems.map((item) => <article key={item.key} className="lt-card p-5 grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,.7fr)] gap-5">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{lang === "fr" ? item.nameFr : item.nameEn}</h2><span className="lt-chip lt-chip-warn">{copy.notProvisioned}</span></div><p className="lt-ink-2 text-sm mt-2">{lang === "fr" ? item.descriptionFr : item.descriptionEn}</p></div>
        <div className="lt-control-requirement"><span className="font-semibold text-xs uppercase tracking-wide">{copy.requirement}</span><p className="lt-ink-2 text-sm mt-1">{lang === "fr" ? item.activationRequirementFr : item.activationRequirementEn}</p></div>
      </article>)}
    </div>}
  </section>;
}
