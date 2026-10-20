// "Connexion FusionPBX" — where the information from Kenny/Phil is entered once, tested for real, then activated.
// Ringotel-like flow: 1 settings -> 2 server secrets -> 3 extensions -> 4 live test -> 5 activation.
// Secrets are write-only: the portal only ever shows "set on <date>".
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, KeyRound, Loader2, PlugZap, Power, RefreshCw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { pbxApi, PbxApiError, settingsFromForm, suggestedWssUrl, type PbxCheck, type PbxSecretKind, type PbxState } from "./lemtelPbxApi";

type Lang = "fr" | "en";
type Props = { lang: Lang; organizationId: string | null; readonly: boolean };
const L = (lang: Lang, fr: string, en: string) => (lang === "fr" ? fr : en);

const ERRORS: Record<string, [string, string]> = {
  validation_not_passed: ["Lancez un test de connexion réussi avant d’activer.", "Run a passing connection test before activating."],
  validation_expired_revalidate: ["Le dernier test date de plus de 24 h : relancez-le.", "The last test is older than 24 h: run it again."],
  connection_not_configured: ["Enregistrez d’abord les paramètres FusionPBX.", "Save the FusionPBX settings first."],
  save_settings_first: ["Enregistrez d’abord les paramètres FusionPBX.", "Save the FusionPBX settings first."],
  server_encryption_key_missing: ["La clé de chiffrement serveur n’est pas installée (déploiement).", "The server encryption key is not installed (deployment)."],
  extension_already_assigned: ["Cette extension est déjà attribuée à un autre utilisateur.", "This extension is already assigned to another user."],
  user_not_active_member: ["Cet utilisateur n’est pas membre actif de l’organisation.", "This user is not an active member of the organization."],
  invalid_wss_url_wss_required: ["L’URL WSS doit commencer par wss:// (TLS obligatoire).", "The WSS URL must start with wss:// (TLS required)."],
  invalid_sip_domain: ["Domaine SIP invalide (nom de domaine, pas une IP).", "Invalid SIP domain (a domain name, not an IP)."],
  invalid_pbx_host: ["Hôte PBX invalide.", "Invalid PBX host."],
  invalid_turn_urls: ["URL TURN invalide (ex. turns:turn.exemple.com:5349?transport=tcp, sans identifiant).", "Invalid TURN URL (e.g. turns:turn.example.com:5349?transport=tcp, no credentials)."],
  invalid_stun_urls: ["URL STUN invalide (ex. stun:stun.exemple.com:3478).", "Invalid STUN URL (e.g. stun:stun.example.com:3478)."],
  invalid_secret: ["Secret refusé : 16 à 256 caractères imprimables, sans espace.", "Secret refused: 16 to 256 printable characters, no spaces."],
  invalid_sip_password: ["Mot de passe SIP refusé : 6 à 256 caractères imprimables, sans espace.", "SIP password refused: 6 to 256 printable characters, no spaces."],
  invalid_extension: ["Extension invalide (2 à 8 chiffres).", "Invalid extension (2 to 8 digits)."],
  function_not_deployed: ["Le service de connexion PBX n’est pas encore déployé sur le serveur.", "The PBX connection service is not deployed on the server yet."],
  portal_readonly: ["Le portail est en lecture seule.", "The portal is read-only."],
  forbidden: ["Réservé aux propriétaires/administrateurs de l’organisation.", "Reserved to organization owners/administrators."],
};
const CHECK_LABELS: Record<string, [string, string]> = {
  wss_tls_websocket: ["WSS : TLS + WebSocket (sous-protocole sip)", "WSS: TLS + WebSocket (sip subprotocol)"],
  sip_options: ["SIP : réponse du PBX (OPTIONS)", "SIP: PBX answers (OPTIONS)"],
  turn_relay: ["TURN : relais média", "TURN: media relay"],
  register_test_extension: ["Enregistrement d’une extension de test", "Test extension registration"],
  server_encryption_key: ["Clé de chiffrement serveur", "Server encryption key"],
};
const DETAILS: Record<string, [string, string]> = {
  websocket_sip_subprotocol_open: ["ouvert", "open"],
  wss_unreachable_or_tls_rejected: ["injoignable ou certificat refusé (certificat CA valide requis sur 7443)", "unreachable or certificate refused (valid CA certificate required on 7443)"],
  registered_and_unregistered: ["enregistrée puis désenregistrée (identifiants corrects)", "registered then unregistered (credentials correct)"],
  credentials_rejected: ["identifiants refusés", "credentials rejected"],
  forbidden_check_acl_or_domain: ["refusé (403) : vérifier mot de passe, domaine ou ACL", "refused (403): check password, domain or ACL"],
  extension_or_domain_unknown: ["extension ou domaine inconnu", "unknown extension or domain"],
  no_test_extension_with_credential: ["aucune extension de test avec mot de passe", "no test extension with a password"],
  configured_short_lived_credentials: ["configuré (identifiants temporaires)", "configured (short-lived credentials)"],
  turn_not_configured_media_may_fail_behind_nat: ["non configuré : l’audio peut échouer derrière un NAT", "not configured: audio may fail behind NAT"],
  turn_secret_missing: ["secret TURN manquant", "TURN secret missing"],
  sip_response_timeout: ["pas de réponse SIP (délai)", "no SIP response (timeout)"],
  wss_not_open: ["non testé (WSS fermé)", "not tested (WSS closed)"],
};
const errorText = (lang: Lang, e: unknown) => {
  const code = e instanceof PbxApiError ? e.code : "server_error";
  const m = ERRORS[code];
  return m ? L(lang, m[0], m[1]) : `${L(lang, "Erreur", "Error")} : ${code}`;
};

const EMPTY_FORM = { sipDomain: "", pbxHost: "", sipTransport: "tls", sipPort: "5061", wssUrl: "", outboundProxy: "", stunUrls: "", turnUrls: "",
  registrationExpires: "300", codecs: "opus, PCMU, PCMA", srtpMode: "dtls_srtp", managementMode: "none", managementBaseUrl: "", managementDomainUuid: "", managementUsername: "" };

export default function LemtelPbxConnection({ lang, organizationId, readonly }: Props) {
  const [state, setState] = useState<PbxState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [secretDraft, setSecretDraft] = useState<Record<PbxSecretKind, string>>({ turn_shared_secret: "", fusionpbx_api_key: "", fusionpbx_web_password: "" });
  const [assign, setAssign] = useState({ userId: "", extension: "", authUsername: "", displayName: "", isTest: true, sipPassword: "" });
  const [report, setReport] = useState<PbxCheck[] | null>(null);

  const apply = useCallback((s: PbxState) => {
    setState(s);
    const c = s.connection;
    if (c) setForm({ sipDomain: c.sipDomain, pbxHost: c.pbxHost, sipTransport: c.sipTransport, sipPort: String(c.sipPort), wssUrl: c.wssUrl,
      outboundProxy: c.outboundProxy ?? "", stunUrls: c.stunUrls.join(", "), turnUrls: c.turnUrls.join(", "), registrationExpires: String(c.registrationExpires),
      codecs: c.codecs.join(", "), srtpMode: c.srtpMode, managementMode: c.managementMode, managementBaseUrl: c.managementBaseUrl ?? "",
      managementDomainUuid: c.managementDomainUuid ?? "", managementUsername: c.managementUsername ?? "" });
    setReport(c?.lastValidation?.checks ?? null);
  }, []);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoadError(null);
    try { apply(await pbxApi.get(organizationId)); } catch (e) { setLoadError(errorText(lang, e)); }
  }, [apply, lang, organizationId]);
  useEffect(() => { setState(null); setForm(EMPTY_FORM); setReport(null); void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>, success?: string) => {
    setBusy(key);
    try { await fn(); if (success) toast.success(success); } catch (e) { toast.error(errorText(lang, e)); } finally { setBusy(null); }
  };

  const c = state?.connection ?? null;
  const steps = useMemo(() => {
    const testExt = state?.assignments.some((a) => a.isTest && a.credentialSet) ?? false;
    return [
      { label: L(lang, "Paramètres FusionPBX", "FusionPBX settings"), done: Boolean(c) },
      { label: L(lang, "Secrets serveur", "Server secrets"), done: Boolean(state?.serverReadiness.encryptionKeyConfigured) && (!c?.turnUrls.length || Boolean(state?.secrets.turn_shared_secret.set)) },
      { label: L(lang, "Extensions", "Extensions"), done: testExt },
      { label: L(lang, "Test réel", "Live test"), done: Boolean(c?.lastValidation?.passed) },
      { label: L(lang, "Activation", "Activation"), done: c?.state === "active" },
    ];
  }, [c, lang, state]);

  if (!organizationId) return null;
  const stateChip = !c ? ["lt-chip-warn", L(lang, "Non configuré", "Not configured")]
    : c.state === "active" ? ["lt-chip-ok", L(lang, "Actif", "Active")]
    : c.state === "validated" ? ["lt-chip-cyan", L(lang, "Validé — prêt à activer", "Validated — ready to activate")]
    : c.state === "suspended" ? ["lt-chip-warn", L(lang, "Suspendu", "Suspended")] : ["lt-chip-warn", L(lang, "Brouillon", "Draft")];
  const field = (key: string, label: string, opts: { placeholder?: string; help?: string; type?: string } = {}) => (
    <label className="block text-sm"><span className="lt-ink-2 text-xs">{label}</span>
      <input className="lt-input mt-1" type={opts.type ?? "text"} value={form[key]} placeholder={opts.placeholder} disabled={readonly}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value, ...(key === "pbxHost" && !f.wssUrl ? { wssUrl: suggestedWssUrl(e.target.value) } : {}) }))} />
      {opts.help && <span className="lt-ink-2 text-xs">{opts.help}</span>}</label>
  );
  const select = (key: string, label: string, options: Array<[string, string]>) => (
    <label className="block text-sm"><span className="lt-ink-2 text-xs">{label}</span>
      <select className="lt-input mt-1" value={form[key]} disabled={readonly} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
  );

  return (
    <section className="lt-card p-5 mb-6" aria-labelledby="lt-pbx-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><PlugZap className="w-5 h-5" /><h2 id="lt-pbx-title" className="font-semibold">{L(lang, "Connexion FusionPBX", "FusionPBX connection")}</h2><span className={`lt-chip ${stateChip[0]}`}>{stateChip[1]}</span></div>
          <p className="lt-ink-2 text-sm mt-1">{L(lang, "Saisissez ici les informations fournies par Kenny/Phil. Le portail teste réellement la connexion (WSS, SIP, enregistrement d’une extension) puis, une fois activée, Mobile et Desktop reçoivent automatiquement la même configuration.", "Enter the information provided by Kenny/Phil here. The portal really tests the connection (WSS, SIP, extension registration); once activated, Mobile and Desktop automatically receive the same configuration.")}</p></div>
        <button className="lt-btn lt-btn-ghost" onClick={() => void load()} disabled={busy !== null}><RefreshCw className="w-4 h-4" />{L(lang, "Actualiser", "Refresh")}</button>
      </div>
      {loadError && <p className="lt-error mt-3" role="alert">{loadError}</p>}
      <ol className="flex flex-wrap gap-2 mt-4" aria-label={L(lang, "Étapes", "Steps")}>
        {steps.map((s, i) => <li key={s.label} className={`lt-chip ${s.done ? "lt-chip-ok" : "lt-chip-warn"}`}>{s.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />}{i + 1}. {s.label}</li>)}
      </ol>
      {state && (!state.serverReadiness.encryptionKeyConfigured || !state.serverReadiness.credentialDeliveryEnabled) && (
        <div className="lt-card p-3 mt-4 text-sm"><CircleAlert className="w-4 h-4 inline mr-1" />
          {!state.serverReadiness.encryptionKeyConfigured && L(lang, "Clé de chiffrement serveur absente : à installer au déploiement avant de saisir des secrets. ", "Server encryption key missing: install it at deployment before entering secrets. ")}
          {!state.serverReadiness.credentialDeliveryEnabled && L(lang, "Distribution des identifiants aux applications désactivée (interrupteur plateforme) : les apps recevront la configuration sans mot de passe tant qu’elle n’est pas activée.", "Credential delivery to the apps is disabled (platform switch): apps receive the configuration without a password until it is enabled.")}
        </div>)}

      <h3 className="font-semibold mt-6">1. {L(lang, "Paramètres FusionPBX (non secrets)", "FusionPBX settings (non-secret)")}</h3>
      <div className="grid md:grid-cols-2 gap-3 mt-2">
        {field("pbxHost", L(lang, "Hôte PBX (FQDN)", "PBX host (FQDN)"), { placeholder: "pbxnode.lemtel.tel" })}
        {field("sipDomain", L(lang, "Domaine SIP (domaine FusionPBX)", "SIP domain (FusionPBX domain)"), { placeholder: "lemtel.lemtel.tel" })}
        {field("wssUrl", L(lang, "URL WSS (profil internal, wss-binding)", "WSS URL (internal profile, wss-binding)"), { placeholder: "wss://pbxnode.lemtel.tel:7443", help: L(lang, "Certificat CA valide requis (pas d’auto-signé).", "Valid CA certificate required (no self-signed).") })}
        {field("outboundProxy", L(lang, "Proxy sortant (optionnel, hôte:port)", "Outbound proxy (optional, host:port)"))}
        {select("sipTransport", L(lang, "Transport SIP des téléphones (référence)", "Desk-phone SIP transport (reference)"), [["tls", "TLS"], ["tcp", "TCP"], ["udp", "UDP"]])}
        {field("sipPort", L(lang, "Port SIP", "SIP port"), { type: "number" })}
        {field("stunUrls", L(lang, "Serveurs STUN", "STUN servers"), { placeholder: "stun:turn.lemtel.tel:3478" })}
        {field("turnUrls", L(lang, "Serveurs TURN (sans identifiant)", "TURN servers (no credentials)"), { placeholder: "turns:turn.lemtel.tel:5349?transport=tcp" })}
        {field("registrationExpires", L(lang, "Durée d’enregistrement (s)", "Registration expiry (s)"), { type: "number" })}
        {field("codecs", L(lang, "Codecs (ordre de préférence)", "Codecs (preference order)"))}
        {select("srtpMode", L(lang, "Chiffrement média", "Media encryption"), [["dtls_srtp", "DTLS-SRTP (WebRTC)"], ["sdes", "SDES-SRTP"], ["none", L(lang, "Aucun", "None")]])}
        {select("managementMode", L(lang, "Accès gestion FusionPBX", "FusionPBX management access"), [["none", L(lang, "Aucun (registrations seulement)", "None (registrations only)")], ["fusionpbx_api", L(lang, "API FusionPBX (clé)", "FusionPBX API (key)")]])}
        {form.managementMode === "fusionpbx_api" && field("managementBaseUrl", L(lang, "URL de base API (https)", "API base URL (https)"), { placeholder: "https://pbxnode.lemtel.tel" })}
        {form.managementMode === "fusionpbx_api" && field("managementDomainUuid", L(lang, "domain_uuid FusionPBX de cette organisation", "FusionPBX domain_uuid of this organization"), { placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", help: L(lang, "Une organisation Lemtel = un domaine FusionPBX. Toutes les opérations sont limitées à ce domaine.", "One Lemtel organization = one FusionPBX domain. Every operation is confined to this domain.") })}
        {form.managementMode === "fusionpbx_api" && field("managementUsername", L(lang, "Utilisateur API FusionPBX (écritures)", "FusionPBX API user (writes)"), { placeholder: "lemtel-api" })}
      </div>
      <button className="lt-btn lt-btn-gold mt-3" disabled={readonly || busy !== null} onClick={() => void run("save", async () => apply(await pbxApi.saveSettings(organizationId, settingsFromForm(form))), L(lang, "Paramètres enregistrés. Un nouveau test est requis.", "Settings saved. A new test is required."))}>
        {busy === "save" && <Loader2 className="w-4 h-4 animate-spin" />}{L(lang, "Enregistrer les paramètres", "Save settings")}</button>

      <h3 className="font-semibold mt-6">2. {L(lang, "Secrets serveur (écriture seule)", "Server secrets (write-only)")}</h3>
      <div className="grid md:grid-cols-2 gap-3 mt-2">
        {(["turn_shared_secret", "fusionpbx_api_key", "fusionpbx_web_password"] as PbxSecretKind[]).map((kind) => {
          const s = state?.secrets[kind];
          return <div key={kind} className="text-sm"><span className="lt-ink-2 text-xs"><KeyRound className="w-3.5 h-3.5 inline" /> {kind === "turn_shared_secret" ? L(lang, "Secret partagé TURN (coturn use-auth-secret)", "TURN shared secret (coturn use-auth-secret)") : kind === "fusionpbx_api_key" ? L(lang, "Clé API FusionPBX", "FusionPBX API key") : L(lang, "Mot de passe web FusionPBX (écoute des enregistrements)", "FusionPBX web password (recording playback)")}</span>
            <div className="flex gap-2 mt-1"><input className="lt-input" type="password" autoComplete="off" value={secretDraft[kind]} disabled={readonly || !c} placeholder={s?.set ? L(lang, "défini — saisir pour remplacer", "set — type to replace") : ""} onChange={(e) => setSecretDraft((d) => ({ ...d, [kind]: e.target.value }))} />
              <button className="lt-btn lt-btn-ghost" disabled={readonly || busy !== null || !secretDraft[kind]} onClick={() => void run(kind, async () => { await pbxApi.setSecret(organizationId, kind, secretDraft[kind]); setSecretDraft((d) => ({ ...d, [kind]: "" })); await load(); }, L(lang, "Secret enregistré (chiffré).", "Secret saved (encrypted)."))}>{L(lang, "Enregistrer", "Save")}</button>
              {s?.set && <button className="lt-btn lt-btn-ghost" aria-label={L(lang, "Effacer", "Clear")} disabled={readonly || busy !== null} onClick={() => void run(kind + "-clear", async () => { await pbxApi.clearSecret(organizationId, kind); await load(); })}><Trash2 className="w-4 h-4" /></button>}</div>
            <span className="lt-ink-2 text-xs">{s?.set ? `${L(lang, "Défini le", "Set on")} ${new Date(s.setAt!).toLocaleString(lang)}` : L(lang, "Non défini", "Not set")}</span></div>;
        })}
      </div>

      <h3 className="font-semibold mt-6">3. {L(lang, "Extensions des utilisateurs", "User extensions")}</h3>
      <div className="overflow-x-auto mt-2"><table className="w-full text-sm"><thead><tr className="lt-ink-2 text-xs text-left"><th className="py-1">{L(lang, "Utilisateur", "User")}</th><th>{L(lang, "Extension", "Extension")}</th><th>{L(lang, "Test", "Test")}</th><th>{L(lang, "Mot de passe SIP", "SIP password")}</th><th /></tr></thead>
        <tbody>{(state?.assignments ?? []).map((a) => <tr key={a.userId} className="border-t border-white/10"><td className="py-1">{a.userName ?? a.email ?? a.userId}</td><td>{a.extension}{a.authUsername ? ` (${a.authUsername})` : ""}</td><td>{a.isTest ? "✓" : ""}</td>
          <td>{a.credentialSet ? <span className="lt-chip lt-chip-ok"><ShieldCheck className="w-3.5 h-3.5" />{L(lang, "défini", "set")}</span> : <span className="lt-chip lt-chip-warn">{L(lang, "manquant", "missing")}</span>}</td>
          <td className="text-right"><button className="lt-btn lt-btn-ghost" aria-label={L(lang, "Retirer", "Remove")} disabled={readonly || busy !== null} onClick={() => void run("un-" + a.userId, async () => apply(await pbxApi.unassign(organizationId, a.userId)))}><Trash2 className="w-4 h-4" /></button></td></tr>)}
          {state && state.assignments.length === 0 && <tr><td colSpan={5} className="lt-ink-2 py-2">{L(lang, "Aucune extension attribuée. Commencez par les 2 extensions de test fournies par Kenny/Phil.", "No extension assigned. Start with the 2 test extensions provided by Kenny/Phil.")}</td></tr>}</tbody></table></div>
      <div className="grid md:grid-cols-6 gap-2 mt-3 items-end">
        <label className="text-sm md:col-span-2"><span className="lt-ink-2 text-xs">{L(lang, "Membre", "Member")}</span><select className="lt-input mt-1" value={assign.userId} disabled={readonly || !c} onChange={(e) => setAssign((a) => ({ ...a, userId: e.target.value }))}><option value="">—</option>{(state?.members ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name} — {m.email}</option>)}</select></label>
        <label className="text-sm"><span className="lt-ink-2 text-xs">{L(lang, "Extension", "Extension")}</span><input className="lt-input mt-1" inputMode="numeric" value={assign.extension} disabled={readonly || !c} onChange={(e) => setAssign((a) => ({ ...a, extension: e.target.value.trim() }))} /></label>
        <label className="text-sm"><span className="lt-ink-2 text-xs">{L(lang, "Nom d’auth. (si différent)", "Auth name (if different)")}</span><input className="lt-input mt-1" value={assign.authUsername} disabled={readonly || !c} onChange={(e) => setAssign((a) => ({ ...a, authUsername: e.target.value.trim() }))} /></label>
        <label className="text-sm"><span className="lt-ink-2 text-xs">{L(lang, "Mot de passe SIP", "SIP password")}</span><input className="lt-input mt-1" type="password" autoComplete="off" value={assign.sipPassword} disabled={readonly || !c} onChange={(e) => setAssign((a) => ({ ...a, sipPassword: e.target.value }))} /></label>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={assign.isTest} disabled={readonly || !c} onChange={(e) => setAssign((a) => ({ ...a, isTest: e.target.checked }))} />{L(lang, "Extension de test", "Test extension")}</label>
      </div>
      <button className="lt-btn lt-btn-gold mt-3" disabled={readonly || busy !== null || !c || !assign.userId || !assign.extension} onClick={() => void run("assign", async () => {
        apply(await pbxApi.assign(organizationId, { userId: assign.userId, extension: assign.extension, authUsername: assign.authUsername || null, displayName: null, isTest: assign.isTest }, assign.sipPassword || null));
        setAssign({ userId: "", extension: "", authUsername: "", displayName: "", isTest: true, sipPassword: "" });
      }, L(lang, "Extension attribuée.", "Extension assigned."))}><UserPlus className="w-4 h-4" />{L(lang, "Attribuer l’extension", "Assign extension")}</button>

      <h3 className="font-semibold mt-6">4. {L(lang, "Test réel de la connexion", "Live connection test")}</h3>
      <p className="lt-ink-2 text-xs mt-1">{L(lang, "Le serveur ouvre le WSS, interroge le PBX (OPTIONS), enregistre puis désenregistre jusqu’à 2 extensions de test. Aucun appel n’est passé.", "The server opens the WSS, queries the PBX (OPTIONS), registers then unregisters up to 2 test extensions. No call is placed.")}</p>
      <button className="lt-btn lt-btn-ghost mt-2" disabled={readonly || busy !== null || !c} onClick={() => void run("validate", async () => { const r = await pbxApi.validate(organizationId); apply(r); setReport(r.report.checks); toast[r.report.passed ? "success" : "error"](r.report.passed ? L(lang, "Connexion validée.", "Connection validated.") : L(lang, "Test échoué : voir le détail.", "Test failed: see details.")); })}>
        {busy === "validate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}{L(lang, "Tester la connexion", "Test the connection")}</button>
      {report && <ul className="mt-3 space-y-1 text-sm">{report.map((k) => {
        const label = CHECK_LABELS[k.key] ?? (k.key.startsWith("register_") ? [`Enregistrement extension ${k.key.slice(9)}`, `Extension ${k.key.slice(9)} registration`] : [k.key, k.key]);
        const detail = DETAILS[k.detail] ?? [k.detail.replace(/_/g, " "), k.detail.replace(/_/g, " ")];
        return <li key={k.key} className="flex items-center gap-2">{k.status === "ok" ? <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--lt-ok, 142 70% 45%))" }} /> : k.status === "failed" ? <CircleAlert className="w-4 h-4" style={{ color: "hsl(0 80% 60%)" }} /> : <CircleDashed className="w-4 h-4 lt-ink-2" />}<span>{L(lang, label[0], label[1])}</span><span className="lt-ink-2">— {L(lang, detail[0], detail[1])}</span></li>;
      })}{c?.lastValidation && <li className="lt-ink-2 text-xs">{L(lang, "Testé le", "Tested on")} {new Date(c.lastValidation.checkedAt).toLocaleString(lang)}</li>}</ul>}

      <h3 className="font-semibold mt-6">5. {L(lang, "Activation", "Activation")}</h3>
      <p className="lt-ink-2 text-xs mt-1">{L(lang, "Une fois active, chaque utilisateur avec une extension reçoit la connexion dans Mobile et Desktop à sa prochaine ouverture. Toute modification des paramètres repasse la connexion en brouillon.", "Once active, every user with an extension receives the connection in Mobile and Desktop at next launch. Any settings change puts the connection back to draft.")}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        {c?.state !== "active" ? <button className="lt-btn lt-btn-gold" disabled={readonly || busy !== null || Boolean(state?.activationBlocker)} title={state?.activationBlocker ? errorText(lang, new PbxApiError(state.activationBlocker, 409)) : undefined} onClick={() => void run("activate", async () => apply(await pbxApi.setState(organizationId, "active")), L(lang, "Connexion activée : les applications peuvent se connecter.", "Connection activated: the apps can connect."))}><Power className="w-4 h-4" />{L(lang, "Activer la connexion", "Activate the connection")}</button>
          : <button className="lt-btn lt-btn-ghost" disabled={readonly || busy !== null} onClick={() => void run("suspend", async () => apply(await pbxApi.setState(organizationId, "suspended")), L(lang, "Connexion suspendue.", "Connection suspended."))}><Power className="w-4 h-4" />{L(lang, "Suspendre", "Suspend")}</button>}
        {state?.activationBlocker && c?.state !== "active" && <span className="lt-ink-2 text-xs self-center">{errorText(lang, new PbxApiError(state.activationBlocker, 409))}</span>}
      </div>
    </section>
  );
}
