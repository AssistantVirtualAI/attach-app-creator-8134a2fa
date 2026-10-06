import { useState } from "react";
import type { LemtelErrorKey } from "./lemtelHostedApi";
import type { RowIssue } from "./lemtelCsv";

export type Lang = "fr" | "en";

const fr = {
  brand: "Lemtel Telecom", tagline: "Communications privées et intelligentes",
  nav: { overview: "Aperçu", organizations: "Organisations", people: "Personnes", invitations: "Invitations", devices: "Appareils et téléchargements", security: "Sécurité", activity: "Activité" },
  search: "Rechercher", help: "Aide", notifications: "Notifications", signOut: "Se déconnecter", allOrgs: "Toutes les organisations",
  readonlyTitle: "Portail en lecture seule",
  readonlyBody: "La création de comptes est réservée aux administrateurs Lemtel et n'est pas encore activée sur ce poste. Aucune action n'est envoyée.",
  empty: { orgs: "Aucune organisation pour l'instant.", people: "Aucune personne dans cette organisation.", invites: "Aucune invitation.", activity: "Aucune activité récente." },
  newOrg: "Nouvelle organisation", orgName: "Nom de l'entreprise / organisation", slug: "Identifiant d'adresse",
  slugHint: "Lettres minuscules, chiffres et traits d'union.", defaultLang: "Langue par défaut", french: "Français", english: "Anglais",
  adminName: "Nom complet de l'administrateur", adminEmail: "Courriel de l'administrateur", orgColor: "Couleur de l'organisation (facultatif)",
  securityTitle: "Ce qui va se passer",
  securityItems: [
    "L'administrateur reçoit un courriel de bienvenue.",
    "Son adresse courriel devient son nom d'utilisateur.",
    "Il reçoit un mot de passe temporaire.",
    "À la première connexion, il choisit un mot de passe personnel.",
    "Les réglages téléphoniques se chargent seulement après une connexion sécurisée. Le client ne les saisit jamais.",
  ],
  create: "Créer l'organisation", cancel: "Annuler", back: "Retour", next: "Suivant", confirm: "Confirmer",
  previewEmail: "Aperçu du courriel", orgCreated: "Organisation créée — courriel de bienvenue envoyé.",
  members: "membres", pending: "en attente", administrator: "Administrateur", health: "Intégration",
  healthy: "Complète", inProgress: "En cours", attention: "À vérifier",
  invitePerson: "Inviter une personne", firstName: "Prénom", lastName: "Nom", email: "Courriel (nom d'utilisateur)",
  language: "Langue", inherit: "Langue de l'organisation", role: "Rôle", roles: { user: "Utilisateur", manager: "Gestionnaire", administrator: "Administrateur" },
  department: "Service (facultatif)", title: "Titre (facultatif)", sendNow: "Envoyer l'invitation maintenant",
  invite: "Inviter", inviteSent: "Invitation envoyée. Vous pourrez la renvoyer au besoin.", inviteSaved: "Personne ajoutée. L'invitation n'est pas encore envoyée.",
  bulk: "Importer en lot", template: "Télécharger le modèle CSV", drop: "Glissez un fichier CSV ici ou cliquez pour choisir",
  headerError: "Le fichier doit contenir les colonnes first_name, last_name et email.",
  valid: "valides", warnings: "avertissements", invalid: "invalides", line: "Ligne",
  issues: {
    missing_name: "Prénom ou nom manquant", invalid_email: "Courriel invalide", duplicate_email: "Courriel en double",
    invalid_language: "Langue invalide (fr ou en)", invalid_role: "Rôle invalide", language_inherited: "Langue de l'organisation utilisée",
  } as Record<RowIssue, string>,
  confirmBulk: (n: number) => `Créer ${n} compte${n > 1 ? "s" : ""}`, langDist: "Répartition des langues",
  results: "Résultats", created: "Créés", invited: "Invités", skipped: "Ignorés", failed: "Échecs", exportResults: "Exporter les résultats",
  inv: {
    sent: "Envoyée", delivered: "Remise", opened: "Ouverte", temp_pending: "Mot de passe temporaire non utilisé",
    active: "Mot de passe personnalisé / actif", expired: "Expirée", resend_available: "Renvoi possible", revoked: "Révoquée",
  } as Record<string, string>,
  resend: "Renvoyer", replace: "Nouveau mot de passe temporaire", revoke: "Révoquer",
  confirmResend: "Renvoyer l'invitation? Un nouveau courriel sera envoyé à cette personne.",
  confirmReplace: "Émettre un nouveau mot de passe temporaire? L'ancien cessera de fonctionner immédiatement.",
  confirmRevoke: "Révoquer cette invitation? La personne ne pourra plus se connecter avec ce courriel tant qu'elle n'est pas réinvitée.",
  done: "C'est fait.",
  downloads: "Télécharger les applications", desktop: "macOS / Bureau", ios: "iOS", android: "Android", notConfigured: "Lien non configuré",
  securityPage: [
    "Connexion par courriel et mot de passe seulement.",
    "Les mots de passe temporaires ne sont jamais affichés ni conservés dans le portail.",
    "Chaque personne choisit son mot de passe à la première connexion.",
    "Les réglages téléphoniques sont chargés par le serveur après la connexion.",
  ],
  support: "Contact de soutien", overviewStats: { orgs: "Organisations", people: "Personnes", pending: "Invitations en attente" },
  signIn: "Se connecter", password: "Mot de passe", forgot: "Mot de passe oublié?", signInTitle: "Connexion à Lemtel",
  forgotTitle: "Recevoir un mot de passe temporaire", forgotBody: "Entrez votre courriel. Si un compte existe, nous vous enverrons un nouveau mot de passe temporaire.",
  forgotSend: "Envoyer", forgotDone: "Si un compte existe pour ce courriel, un mot de passe temporaire vient d'être envoyé.",
  backToSignIn: "Retour à la connexion", cooldown: (s: number) => `Réessayez dans ${s} s`,
  makeItYours: "Faites-le vôtre", createPwd: "Créez votre mot de passe personnel", newPwd: "Nouveau mot de passe", confirmPwd: "Confirmez le mot de passe",
  continue: "Continuer vers Lemtel", otherAccount: "Utiliser un autre compte", mismatch: "Les mots de passe ne correspondent pas.",
  strength: ["Très faible", "Faible", "Correct", "Fort", "Excellent"],
  strengthHint: "Au moins 12 caractères, avec majuscules, chiffres et symboles.",
  errors: {
    temp_expired: "Demandez un nouveau mot de passe temporaire.",
    already_personalized: "Connectez-vous avec votre mot de passe personnel.",
    network: "Vérifiez votre connexion et réessayez.",
    unavailable: "Lemtel est temporairement indisponible. Réessayez sous peu.",
    invalid_credentials: "Courriel ou mot de passe incorrect.",
    not_allowed: "Votre compte n'a pas accès à cette action.",
    conflict: "Cet élément existe déjà.",
    invalid_input: "Vérifiez les champs indiqués.",
    throttled: "Trop de tentatives. Patientez un moment avant de réessayer.",
    readonly: "La création de comptes n'est pas activée sur ce portail.",
    generic: "Une erreur est survenue. Réessayez.",
  } as Record<LemtelErrorKey, string>,
  mail: {
    subject: "Bienvenue chez Lemtel", hello: (n: string) => `Bonjour ${n},`,
    intro: (o: string) => `Votre espace Lemtel pour ${o} est prêt.`, username: "Nom d'utilisateur", tempPwd: "Mot de passe temporaire",
    tempPlaceholder: "(fourni par le serveur au moment de l'envoi)", stepsTitle: "Première connexion",
    steps: ["Entrez votre courriel et le mot de passe temporaire.", "Créez votre mot de passe personnel.", "Accédez à votre espace Lemtel."],
    note: "Ne partagez jamais ce mot de passe temporaire. Changez-le dès votre première connexion; il expire rapidement.",
    getApps: "Téléchargez l'application", supportLine: "Besoin d'aide? Écrivez-nous :",
  },
};

const en: typeof fr = {
  brand: "Lemtel Telecom", tagline: "Private, intelligent communications",
  nav: { overview: "Overview", organizations: "Organizations", people: "People", invitations: "Invitations", devices: "Devices & Downloads", security: "Security", activity: "Activity" },
  search: "Search", help: "Help", notifications: "Notifications", signOut: "Sign out", allOrgs: "All organizations",
  readonlyTitle: "Read-only portal",
  readonlyBody: "Account creation is reserved for Lemtel administrators and is not enabled here yet. No action is sent.",
  empty: { orgs: "No organizations yet.", people: "No people in this organization.", invites: "No invitations.", activity: "No recent activity." },
  newOrg: "New organization", orgName: "Company / organization name", slug: "URL-safe slug",
  slugHint: "Lowercase letters, numbers and hyphens.", defaultLang: "Default language", french: "French", english: "English",
  adminName: "Administrator full name", adminEmail: "Administrator email", orgColor: "Organization color (optional)",
  securityTitle: "What happens next",
  securityItems: [
    "The administrator receives a welcome email.",
    "Their email address becomes their username.",
    "They receive a temporary password.",
    "On first app sign-in, they choose a personal password.",
    "Telephony settings load only after secure sign-in and are never entered by the customer.",
  ],
  create: "Create organization", cancel: "Cancel", back: "Back", next: "Next", confirm: "Confirm",
  previewEmail: "Email preview", orgCreated: "Organization created — welcome email sent.",
  members: "members", pending: "pending", administrator: "Administrator", health: "Onboarding",
  healthy: "Complete", inProgress: "In progress", attention: "Needs attention",
  invitePerson: "Invite person", firstName: "First name", lastName: "Last name", email: "Email (username)",
  language: "Language", inherit: "Organization language", role: "Role", roles: { user: "User", manager: "Manager", administrator: "Administrator" },
  department: "Department (optional)", title: "Title (optional)", sendNow: "Send invitation now",
  invite: "Invite", inviteSent: "Invitation sent. You can resend it if needed.", inviteSaved: "Person added. Invitation not sent yet.",
  bulk: "Bulk invite", template: "Download CSV template", drop: "Drop a CSV file here or click to choose",
  headerError: "The file must include first_name, last_name and email columns.",
  valid: "valid", warnings: "warnings", invalid: "invalid", line: "Line",
  issues: {
    missing_name: "Missing first or last name", invalid_email: "Invalid email", duplicate_email: "Duplicate email",
    invalid_language: "Invalid language (fr or en)", invalid_role: "Invalid role", language_inherited: "Organization language will be used",
  },
  confirmBulk: (n: number) => `Create ${n} account${n > 1 ? "s" : ""}`, langDist: "Language distribution",
  results: "Results", created: "Created", invited: "Invited", skipped: "Skipped", failed: "Failed", exportResults: "Export results",
  inv: {
    sent: "Sent", delivered: "Delivered", opened: "Opened", temp_pending: "Temporary password pending first use",
    active: "Password personalized / active", expired: "Expired", resend_available: "Resend available", revoked: "Revoked",
  },
  resend: "Resend", replace: "Replacement temporary password", revoke: "Revoke",
  confirmResend: "Resend this invitation? A new email will be sent to this person.",
  confirmReplace: "Issue a replacement temporary password? The previous one stops working immediately.",
  confirmRevoke: "Revoke this invitation? This person cannot sign in with this email until invited again.",
  done: "Done.",
  downloads: "Download the apps", desktop: "macOS / Desktop", ios: "iOS", android: "Android", notConfigured: "Link not configured",
  securityPage: [
    "Email and password sign-in only.",
    "Temporary passwords are never displayed or stored in the portal.",
    "Every person chooses their own password on first sign-in.",
    "Telephony settings are loaded by the server after sign-in.",
  ],
  support: "Support contact", overviewStats: { orgs: "Organizations", people: "People", pending: "Pending invitations" },
  signIn: "Sign in", password: "Password", forgot: "Forgot password?", signInTitle: "Sign in to Lemtel",
  forgotTitle: "Get a temporary password", forgotBody: "Enter your email. If an account exists, we'll send you a new temporary password.",
  forgotSend: "Send", forgotDone: "If an account exists for this email, a temporary password has just been sent.",
  backToSignIn: "Back to sign in", cooldown: (s: number) => `Try again in ${s}s`,
  makeItYours: "Make it yours", createPwd: "Create your personal password", newPwd: "New password", confirmPwd: "Confirm password",
  continue: "Continue to Lemtel", otherAccount: "Use another account", mismatch: "Passwords do not match.",
  strength: ["Very weak", "Weak", "Fair", "Strong", "Excellent"],
  strengthHint: "At least 12 characters, with uppercase, numbers and symbols.",
  errors: {
    temp_expired: "Request a new temporary password.",
    already_personalized: "Sign in with your personal password.",
    network: "Check your connection and try again.",
    unavailable: "Lemtel is temporarily unavailable. Please try again shortly.",
    invalid_credentials: "Incorrect email or password.",
    not_allowed: "Your account does not have access to this action.",
    conflict: "This item already exists.",
    invalid_input: "Check the highlighted fields.",
    throttled: "Too many attempts. Please wait a moment before trying again.",
    readonly: "Account creation is not enabled on this portal.",
    generic: "Something went wrong. Please try again.",
  },
  mail: {
    subject: "Welcome to Lemtel", hello: (n: string) => `Hello ${n},`,
    intro: (o: string) => `Your Lemtel workspace for ${o} is ready.`, username: "Username", tempPwd: "Temporary password",
    tempPlaceholder: "(provided by the server at send time)", stepsTitle: "First sign-in",
    steps: ["Enter your email and the temporary password.", "Create your personal password.", "Access your Lemtel workspace."],
    note: "Never share this temporary password. Change it on your first sign-in; it expires quickly.",
    getApps: "Download the app", supportLine: "Need help? Contact us:",
  },
};

export const LEMTEL_DICT = { fr, en };
export type LemtelDict = typeof fr;

export function useLemtelLang() {
  const [lang, setLang] = useState<Lang>(() => (typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "en" : "fr"));
  return { lang, setLang, t: LEMTEL_DICT[lang] };
}

export function passwordStrength(p: string): number {
  let s = 0;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  if (p.length < 8) return 0;
  return s;
}
