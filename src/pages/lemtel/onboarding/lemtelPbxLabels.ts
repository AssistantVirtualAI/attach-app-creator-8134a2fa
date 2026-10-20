// FR/EN labels for the telephony workspace (resource names, field names, server error codes).
export type Lang = "fr" | "en";
type P = [fr: string, en: string];
export const L = (lang: Lang, fr: string, en: string) => (lang === "fr" ? fr : en);

export const RESOURCE_LABELS: Record<string, P> = {
  extensions: ["Postes (extensions)", "Extensions"], voicemails: ["Boîtes vocales", "Voicemail boxes"], devices: ["Appareils (téléphones)", "Devices (desk phones)"],
  destinations: ["Numéros entrants (DID)", "Inbound numbers (DIDs)"], ivr_menus: ["Menus vocaux (IVR)", "IVR menus"], ivr_menu_options: ["Options du menu", "Menu options"],
  ring_groups: ["Groupes de sonnerie", "Ring groups"], ring_group_destinations: ["Membres du groupe", "Group members"], call_center_queues: ["Files d’attente", "Call queues"],
  call_center_agents: ["Agents", "Agents"], call_center_tiers: ["Agents de la file", "Queue agents"], conferences: ["Conférences", "Conferences"], call_flows: ["Bascules jour/nuit", "Day/night switches"],
  time_conditions: ["Conditions horaires", "Time conditions"], dialplans: ["Plans de numérotation", "Dialplans"], music_on_hold: ["Musique d’attente", "Music on hold"],
  pbx_users: ["Utilisateurs FusionPBX", "FusionPBX users"], gateways: ["Passerelles (trunks)", "Gateways (trunks)"], sip_profiles: ["Profils SIP", "SIP profiles"], domains: ["Domaines FusionPBX", "FusionPBX domains"],
};
export const CHILD_OF: Record<string, string> = { ivr_menus: "ivr_menu_options", ring_groups: "ring_group_destinations", call_center_queues: "call_center_tiers" };

const FIELD_LABELS: Record<string, P> = {
  extension: ["Poste", "Extension"], number_alias: ["Alias", "Alias"], effective_caller_id_name: ["Nom affiché (interne)", "Caller ID name (internal)"],
  effective_caller_id_number: ["Numéro affiché (interne)", "Caller ID number (internal)"], outbound_caller_id_name: ["Nom affiché (sortant)", "Outbound caller ID name"],
  outbound_caller_id_number: ["Numéro affiché (sortant)", "Outbound caller ID number"], directory_full_name: ["Nom dans l’annuaire", "Directory name"], call_group: ["Groupe d’appel", "Call group"],
  call_timeout: ["Délai de sonnerie (s)", "Ring timeout (s)"], user_record: ["Enregistrement", "Recording"], limit_max: ["Appels simultanés max", "Max simultaneous calls"],
  toll_allow: ["Autorisations d’appel", "Toll allow"], enabled: ["Actif", "Enabled"], description: ["Description", "Description"], password: ["Mot de passe SIP", "SIP password"],
  forward_all_enabled: ["Renvoi de tous les appels", "Forward all calls"], forward_all_destination: ["Destination (tous)", "Destination (all)"],
  forward_busy_enabled: ["Renvoi si occupé", "Forward when busy"], forward_busy_destination: ["Destination (occupé)", "Destination (busy)"],
  forward_no_answer_enabled: ["Renvoi sans réponse", "Forward on no answer"], forward_no_answer_destination: ["Destination (sans réponse)", "Destination (no answer)"],
  forward_user_not_registered_enabled: ["Renvoi si non connecté", "Forward when not registered"], forward_user_not_registered_destination: ["Destination (non connecté)", "Destination (not registered)"],
  do_not_disturb: ["Ne pas déranger", "Do not disturb"], voicemail_id: ["Numéro de boîte", "Mailbox number"], voicemail_mail_to: ["Courriel de notification", "Notification email"],
  voicemail_file: ["Message par courriel", "Message by email"], voicemail_local_after_email: ["Garder après envoi", "Keep after email"], voicemail_transcription_enabled: ["Transcription", "Transcription"],
  voicemail_enabled: ["Active", "Enabled"], voicemail_description: ["Description", "Description"], voicemail_password: ["NIP", "PIN"],
  device_mac_address: ["Adresse MAC", "MAC address"], device_label: ["Libellé", "Label"], device_vendor: ["Fabricant", "Vendor"], device_model: ["Modèle", "Model"], device_template: ["Modèle de config.", "Template"],
  device_enabled: ["Actif", "Enabled"], device_description: ["Description", "Description"], destination_number: ["Numéro", "Number"], destination_type: ["Type", "Type"],
  destination_caller_id_name: ["Préfixe du nom affiché", "Caller ID name prefix"], destination_caller_id_number: ["Numéro affiché", "Caller ID number"], destination_app: ["Action", "Action"],
  destination_data: ["Vers (ex. 1001 XML domaine)", "To (e.g. 1001 XML domain)"], destination_enabled: ["Actif", "Enabled"], destination_description: ["Description", "Description"],
  destination_delay: ["Délai (s)", "Delay (s)"], destination_timeout: ["Sonnerie (s)", "Ring (s)"], destination_prompt: ["Confirmer l’appel", "Confirm call"],
  ivr_menu_name: ["Nom", "Name"], ivr_menu_extension: ["Poste", "Extension"], ivr_menu_greet_long: ["Message d’accueil long", "Long greeting"], ivr_menu_greet_short: ["Message d’accueil court", "Short greeting"],
  ivr_menu_timeout: ["Délai (ms)", "Timeout (ms)"], ivr_menu_exit_app: ["Action de sortie", "Exit action"], ivr_menu_exit_data: ["Destination de sortie", "Exit destination"],
  ivr_menu_max_failures: ["Échecs max", "Max failures"], ivr_menu_max_timeouts: ["Délais max", "Max timeouts"], ivr_menu_digit_len: ["Chiffres max", "Max digits"], ivr_menu_direct_dial: ["Composition directe", "Direct dial"],
  ivr_menu_enabled: ["Actif", "Enabled"], ivr_menu_description: ["Description", "Description"], ivr_menu_option_digits: ["Touche(s)", "Digit(s)"], ivr_menu_option_action: ["Action", "Action"],
  ivr_menu_option_param: ["Destination", "Destination"], ivr_menu_option_order: ["Ordre", "Order"], ivr_menu_option_description: ["Description", "Description"],
  ring_group_name: ["Nom", "Name"], ring_group_extension: ["Poste", "Extension"], ring_group_strategy: ["Stratégie", "Strategy"], ring_group_call_timeout: ["Délai (s)", "Timeout (s)"],
  ring_group_timeout_app: ["Si personne ne répond", "If nobody answers"], ring_group_timeout_data: ["Destination", "Destination"], ring_group_caller_id_name: ["Préfixe du nom", "Caller ID prefix"],
  ring_group_greeting: ["Message d’accueil", "Greeting"], ring_group_enabled: ["Actif", "Enabled"], ring_group_description: ["Description", "Description"],
  queue_name: ["Nom", "Name"], queue_extension: ["Poste", "Extension"], queue_strategy: ["Stratégie", "Strategy"], queue_moh_sound: ["Musique d’attente", "Hold music"],
  queue_record_template: ["Enregistrement", "Recording"], queue_max_wait_time: ["Attente max (s)", "Max wait (s)"], queue_max_wait_time_with_no_agent: ["Attente max sans agent (s)", "Max wait without agent (s)"],
  queue_tier_rules_apply: ["Règles de niveaux", "Tier rules"], queue_timeout_action: ["Action après délai", "Timeout action"], queue_description: ["Description", "Description"],
  agent_name: ["Nom", "Name"], agent_type: ["Type", "Type"], agent_id: ["Identifiant", "ID"], agent_contact: ["Contact (ex. user/1001@domaine)", "Contact (e.g. user/1001@domain)"], agent_status: ["Statut", "Status"],
  agent_call_timeout: ["Sonnerie (s)", "Ring (s)"], agent_max_no_answer: ["Non-réponses max", "Max no answer"], agent_wrap_up_time: ["Temps de clôture (s)", "Wrap-up (s)"],
  agent_reject_delay_time: ["Délai après refus (s)", "Reject delay (s)"], agent_busy_delay_time: ["Délai si occupé (s)", "Busy delay (s)"], agent_password: ["Mot de passe agent", "Agent password"],
  tier_level: ["Niveau", "Level"], tier_position: ["Position", "Position"], conference_name: ["Nom", "Name"], conference_extension: ["Poste", "Extension"], conference_profile: ["Profil", "Profile"],
  conference_flags: ["Options", "Flags"], conference_enabled: ["Active", "Enabled"], conference_description: ["Description", "Description"], conference_pin_number: ["NIP", "PIN"],
  call_flow_name: ["Nom", "Name"], call_flow_extension: ["Poste", "Extension"], call_flow_feature_code: ["Code", "Feature code"], call_flow_status: ["Mode principal actif", "Primary mode on"],
  call_flow_label: ["Libellé principal", "Primary label"], call_flow_alternate_label: ["Libellé alternatif", "Alternate label"], call_flow_enabled: ["Active", "Enabled"], call_flow_description: ["Description", "Description"],
  dialplan_name: ["Nom", "Name"], dialplan_number: ["Numéro", "Number"], dialplan_context: ["Contexte", "Context"], dialplan_order: ["Ordre", "Order"], dialplan_enabled: ["Actif", "Enabled"], dialplan_description: ["Description", "Description"],
  music_on_hold_name: ["Nom", "Name"], music_on_hold_rate: ["Fréquence", "Rate"], username: ["Utilisateur", "Username"], user_email: ["Courriel", "Email"], user_enabled: ["Actif", "Enabled"],
  gateway: ["Nom", "Name"], proxy: ["Proxy", "Proxy"], realm: ["Realm", "Realm"], register: ["S’enregistrer", "Register"], expire_seconds: ["Expiration (s)", "Expiry (s)"], retry_seconds: ["Nouvel essai (s)", "Retry (s)"],
  profile: ["Profil", "Profile"], context: ["Contexte", "Context"], sip_profile_name: ["Nom", "Name"], sip_profile_hostname: ["Hôte", "Hostname"], sip_profile_enabled: ["Actif", "Enabled"],
  sip_profile_description: ["Description", "Description"], domain_name: ["Domaine", "Domain"], domain_enabled: ["Actif", "Enabled"], domain_description: ["Description", "Description"],
};

export function fieldLabel(lang: Lang, field: string): string {
  const p = FIELD_LABELS[field.replace(/_set$/, "")];
  if (p) return field.endsWith("_set") ? `${lang === "fr" ? p[0] : p[1]} ${lang === "fr" ? "(défini)" : "(set)"}` : lang === "fr" ? p[0] : p[1];
  const s = field.replace(/_uuid$/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const resourceLabel = (lang: Lang, key: string) => (RESOURCE_LABELS[key] ? (lang === "fr" ? RESOURCE_LABELS[key][0] : RESOURCE_LABELS[key][1]) : key);

const ERRORS: Record<string, P> = {
  management_not_configured: ["Connexion de gestion FusionPBX non configurée (mode API, URL, domain_uuid).", "FusionPBX management connection not configured (API mode, URL, domain_uuid)."],
  fusionpbx_api_key_missing: ["Clé API FusionPBX non saisie.", "FusionPBX API key not entered."],
  management_writes_disabled: ["Les modifications FusionPBX sont désactivées tant que la plateforme n’a pas enregistré l’accord des responsables du PBX.", "FusionPBX changes are disabled until the platform records the PBX owners’ agreement."],
  management_username_required_for_writes: ["Utilisateur API FusionPBX requis pour les modifications.", "FusionPBX API user required for changes."],
  pbx_unreachable: ["FusionPBX injoignable.", "FusionPBX unreachable."], pbx_forbidden_check_api_key_and_permissions: ["FusionPBX refuse l’accès : vérifier la clé API et les permissions.", "FusionPBX refused access: check the API key and permissions."],
  pbx_rejected_values: ["FusionPBX a refusé les valeurs.", "FusionPBX rejected the values."], not_found: ["Introuvable dans ce domaine.", "Not found in this domain."],
  forbidden: ["Action non autorisée pour votre rôle.", "Action not allowed for your role."], test_management_first: ["Testez d’abord la connexion de gestion.", "Test the management connection first."],
  domain_uuid_not_found_on_pbx: ["Ce domain_uuid n’existe pas sur le FusionPBX.", "This domain_uuid does not exist on FusionPBX."],
  domain_name_unknown_test_management_first: ["Testez d’abord la connexion de gestion (nom du domaine inconnu).", "Test the management connection first (domain name unknown)."],
  fusionpbx_web_password_required_for_recordings: ["Mot de passe web FusionPBX requis pour écouter les enregistrements.", "FusionPBX web password required to play recordings."],
  fusionpbx_web_login_failed: ["Connexion web FusionPBX refusée (enregistrements).", "FusionPBX web login refused (recordings)."], recording_not_available: ["Enregistrement indisponible.", "Recording unavailable."],
  no_extension_assigned: ["Aucun poste ne vous est attribué.", "No extension is assigned to you."], extension_not_found_on_pbx: ["Votre poste est introuvable sur le FusionPBX.", "Your extension was not found on FusionPBX."],
  call_not_found: ["Appel terminé ou introuvable.", "Call ended or not found."], invalid_destination: ["Destination invalide.", "Invalid destination."], invalid_pin: ["NIP invalide (4 à 10 chiffres).", "Invalid PIN (4 to 10 digits)."],
  function_not_deployed: ["Fonction téléphonie pas encore déployée.", "Telephony function not deployed yet."], network: ["Réseau indisponible.", "Network unavailable."], invalid_period: ["Période invalide.", "Invalid period."],
};
export function errorMessage(lang: Lang, code: string): string {
  const e = ERRORS[code];
  if (e) return lang === "fr" ? e[0] : e[1];
  if (code.startsWith("invalid_")) return `${L(lang, "Valeur invalide", "Invalid value")} : ${fieldLabel(lang, code.slice(8))}`;
  if (code.startsWith("missing_")) return `${L(lang, "Champ requis", "Required field")} : ${fieldLabel(lang, code.slice(8))}`;
  if (code.startsWith("field_not_writable_")) return `${L(lang, "Champ non modifiable", "Field not editable")} : ${fieldLabel(lang, code.slice(19))}`;
  return `${L(lang, "Erreur", "Error")} : ${code}`;
}

export function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
