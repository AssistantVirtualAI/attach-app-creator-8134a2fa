// Server-owned, intentionally fail-closed telemetry-free catalog. No provider call, secret, PBX entity, or customer data belongs here.
export type TelephonyReadinessCapability = {
  key: string;
  category: "phone_system" | "call_center" | "analytics_media" | "communications" | "monitoring" | "administration";
  categoryFr: string;
  categoryEn: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string;
  descriptionEn: string;
  activationRequirementFr: string;
  activationRequirementEn: string;
  status: "not_provisioned";
};

const providerGateFr = "Informations fournisseur approuvées, secrets serveur, RLS et prévol réel.";
const providerGateEn = "Approved provider inputs, server-side secrets, RLS, and real preflight.";

const CATEGORY = {
  phone_system: ["Système téléphonique", "Phone system"],
  call_center: ["Centre d’appels", "Call center"],
  analytics_media: ["Analytique et médias", "Analytics and media"],
  communications: ["Communications", "Communications"],
  monitoring: ["Supervision", "Monitoring"],
  administration: ["Administration téléphonie", "Telephony administration"],
} as const;

type Definition = readonly [key: string, category: keyof typeof CATEGORY, nameFr: string, nameEn: string, descriptionFr: string, descriptionEn: string];

const DEFINITIONS: readonly Definition[] = [
  ["extensions", "phone_system", "Extensions", "Extensions", "Numérotation et règles de poste par organisation.", "Organization-scoped extension numbering and rules."],
  ["pbx_users", "phone_system", "Utilisateurs téléphonie", "Telephony users", "Attribution téléphonie aux utilisateurs autorisés.", "Telephony assignment for authorized users."],
  ["devices", "phone_system", "Appareils téléphonie", "Telephony devices", "Inventaire des appareils gérés par le serveur.", "Server-managed device inventory."],
  ["inbound_routes", "phone_system", "Routes entrantes", "Inbound routes", "Routage d’entrée contrôlé par l’organisation.", "Organization-controlled inbound routing."],
  ["time_conditions", "phone_system", "Conditions horaires", "Time conditions", "Calendriers et règles de disponibilité.", "Schedules and availability rules."],
  ["ivr", "phone_system", "IVR / standard automatique", "IVR / auto attendant", "Menus vocaux et destinations validées.", "Voice menus and validated destinations."],
  ["ring_groups", "phone_system", "Groupes de sonnerie", "Ring groups", "Groupes de distribution par organisation.", "Organization-scoped distribution groups."],
  ["gateways", "phone_system", "Passerelles", "Gateways", "Références aux passerelles sous contrôle serveur.", "Server-controlled gateway references."],
  ["voice_gateways", "phone_system", "Passerelles vocales", "Voice gateways", "Politiques de transport vocal préparées.", "Prepared voice transport policies."],
  ["sip_profiles", "phone_system", "Profils SIP", "SIP profiles", "Profils de signalisation protégés côté serveur.", "Server-protected signaling profiles."],
  ["dialplans", "phone_system", "Dialplans", "Dialplans", "Plans de numérotation soumis à revue.", "Review-gated numbering plans."],
  ["feature_codes", "phone_system", "Codes fonctionnels", "Feature codes", "Fonctions de poste contrôlées par politique.", "Policy-controlled extension features."],
  ["call_forwarding", "phone_system", "Renvoi d’appel", "Call forwarding", "Règles de renvoi autorisées par l’organisation.", "Organization-authorized forwarding rules."],
  ["voice_agents", "phone_system", "Agents vocaux", "Voice agents", "Identités d’agents sans accès client implicite.", "Agent identities with no implicit customer access."],
  ["agent_conversations", "phone_system", "Conversations d’agents", "Agent conversations", "Cadre de conversations soumis aux politiques de conservation.", "Conversation framework subject to retention policies."],
  ["customers", "phone_system", "Clients", "Customers", "Répertoire client isolé par organisation.", "Organization-isolated customer directory."],
  ["pbx_settings", "phone_system", "Paramètres PBX", "PBX settings", "Paramètres système réservés aux administrateurs autorisés.", "System settings reserved for authorized administrators."],
  ["queues", "call_center", "Files d’attente", "Queues", "Routage de file par organisation.", "Organization-scoped queue routing."],
  ["queue_agents", "call_center", "Agents de file", "Queue agents", "Affectations d’agents contrôlées par rôles.", "Role-controlled agent assignments."],
  ["conferences", "call_center", "Conférences", "Conferences", "Politiques de conférence sécurisées.", "Secure conference policies."],
  ["music_on_hold", "call_center", "Musique d’attente", "Music on hold", "Médias d’attente avec droits et rétention.", "Hold media with rights and retention."],
  ["recording_rules", "call_center", "Règles d’enregistrement", "Recording rules", "Consentement, rétention et accès aux enregistrements.", "Recording consent, retention, and access rules."],
  ["voicemail_settings", "call_center", "Messagerie vocale", "Voicemail settings", "Boîtes vocales, politiques et accès autorisés.", "Voicemail boxes, policies, and authorized access."],
  ["wallboard", "call_center", "Wallboard", "Wallboard", "Indicateurs anonymisés de centre d’appels.", "Redacted call-center indicators."],
  ["agent_console", "call_center", "Console agent", "Agent console", "Fonctions de console soumises à la session serveur.", "Console functions bound to server sessions."],
  ["call_center_admin", "call_center", "Administration centre d’appels", "Call-center administration", "Politiques opérateur et supervision d’organisation.", "Operator policies and organization oversight."],
  ["telephony_qa", "call_center", "QA téléphonie", "Telephony QA", "Cadre qualité sans contenu de communications exposé.", "Quality framework without exposed communication content."],
  ["media_center", "analytics_media", "Centre média", "Media center", "Médias soumis à autorisation et conservation.", "Authorization- and retention-governed media."],
  ["call_history", "analytics_media", "Historique d’appels", "Call history", "Historique filtré par organisation et autorisation.", "Organization- and authorization-filtered history."],
  ["recordings", "analytics_media", "Enregistrements", "Recordings", "Lecture par chemin authentifié unique.", "Playback through a single authenticated path."],
  ["ai_insights", "analytics_media", "Insights IA", "AI insights", "Résultats IA soumis à confidentialité et audit.", "Privacy- and audit-governed AI results."],
  ["reports", "analytics_media", "Rapports", "Reports", "Rapports redacted et contrôlés par rôle.", "Redacted, role-controlled reporting."],
  ["sms", "communications", "SMS", "SMS", "Messagerie textuelle avec fournisseur et consentement validés.", "Text messaging with approved provider and consent."],
  ["team_chat", "communications", "Chat d’équipe", "Team chat", "Chat isolé par organisation et politiques de rétention.", "Organization-isolated chat and retention policies."],
  ["active_calls", "monitoring", "Appels actifs", "Active calls", "Visibilité opérationnelle sans contenu ni identifiants sensibles.", "Operational visibility without content or sensitive identifiers."],
  ["registrations", "monitoring", "Enregistrements / registrations", "Registrations", "État de registration redacted côté serveur.", "Server-redacted registration state."],
  ["system_status", "monitoring", "Statut système", "System status", "Santé des services de téléphonie par preuves vérifiées.", "Telephony service health backed by verified evidence."],
  ["sync_health", "monitoring", "Santé de synchronisation", "Synchronization health", "État de synchronisation sans données d’appel.", "Synchronization state without call data."],
  ["ai_audit", "monitoring", "Audit IA", "AI audit", "Journal d’événements IA redacted et autorisé.", "Authorized, redacted AI event audit."],
  ["users_access", "administration", "Utilisateurs et accès", "Users and access", "Rôles, invitations, révocations et sessions Lemtel.", "Lemtel roles, invitations, revocations, and sessions."],
  ["app_downloads", "administration", "Téléchargements applications", "Application downloads", "Canaux de distribution signés et contrôlés.", "Controlled signed distribution channels."],
  ["advanced_pbx", "administration", "PBX avancé", "Advanced PBX", "Changements avancés sous contrôle de changement.", "Advanced changes under change control."],
  ["workspace_settings", "administration", "Paramètres d’espace", "Workspace settings", "Préférences d’organisation avec isolation stricte.", "Organization preferences with strict isolation."],
];

export function telephonyReadinessCatalog(): TelephonyReadinessCapability[] {
  return DEFINITIONS.map(([key, category, nameFr, nameEn, descriptionFr, descriptionEn]) => ({
    key,
    category,
    categoryFr: CATEGORY[category][0],
    categoryEn: CATEGORY[category][1],
    nameFr,
    nameEn,
    descriptionFr,
    descriptionEn,
    activationRequirementFr: providerGateFr,
    activationRequirementEn: providerGateEn,
    status: "not_provisioned",
  }));
}
