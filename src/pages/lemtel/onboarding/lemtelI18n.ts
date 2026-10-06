import { useState } from "react";
import type { LemtelErrorKey } from "./lemtelHostedApi";
import type { RowIssue } from "./lemtelCsv";

export type Lang = "fr" | "en";

const fr = {
  brand: "Lemtel", tagline: "Communications privées et intelligentes",
  nav: { overview: "Aperçu", organizations: "Organisations", people: "Personnes", invitations: "Accès et invitations", devices: "Applications", security: "Sécurité", activity: "Activité" },
  search: "Rechercher", help: "Aide", notifications: "Notifications", signOut: "Se déconnecter", allOrgs: "Toutes les organisations",
  readonlyTitle: "Mode consultation", readonlyBody: "Le backend Lemtel n'est pas activé pour l'administration depuis cette version. Aucune modification n'est envoyée.",
  empty: { orgs: "Aucune organisation pour l'instant.", people: "Aucune personne dans cette organisation.", invites: "Aucun accès à gérer.", activity: "Aucune activité récente." },
  newOrg: "Nouvelle organisation", orgName: "Nom de l'entreprise / organisation", slug: "Identifiant d'adresse", slugHint: "Lettres minuscules, chiffres et traits d'union.", defaultLang: "Langue par défaut", french: "Français", english: "English",
  adminName: "Nom complet du propriétaire", adminEmail: "Courriel du propriétaire", securityTitle: "Ce qui va se passer",
  securityItems: ["Le propriétaire reçoit un courriel de bienvenue.", "Son courriel devient son identifiant.", "Le serveur génère un mot de passe temporaire.", "À la première connexion, il choisit son mot de passe personnel.", "Les réglages téléphoniques restent côté serveur jusqu'à leur provisionnement."],
  create: "Créer l'organisation", cancel: "Annuler", back: "Retour", next: "Suivant", previewEmail: "Aperçu du courriel", orgCreated: "Organisation créée. Le courriel de bienvenue est traité par le serveur.",
  members: "membres", pending: "en attente", administrator: "Propriétaire", health: "État", healthy: "Prête", inProgress: "En attente", attention: "À vérifier",
  invitePerson: "Ajouter une personne", firstName: "Prénom", lastName: "Nom", email: "Courriel (identifiant)", language: "Langue", role: "Rôle", roles: { owner: "Propriétaire", admin: "Administrateur", member: "Membre" },
  invite: "Créer et envoyer", inviteSent: "Le compte a été traité. Le serveur envoie le courriel de bienvenue.",
  bulk: "Importer en lot", template: "Télécharger le modèle CSV", drop: "Glissez un fichier CSV ici ou cliquez pour choisir", headerError: "Le fichier doit contenir les colonnes first_name, last_name et email.",
  valid: "valides", warnings: "avertissements", invalid: "invalides", line: "Ligne", issues: { missing_name: "Prénom ou nom manquant", invalid_email: "Courriel invalide", duplicate_email: "Courriel en double", invalid_language: "Langue invalide (fr ou en)", invalid_role: "Rôle invalide (admin ou member)", language_inherited: "Langue de l'organisation utilisée" } as Record<RowIssue, string>,
  confirmBulk: (count: number) => `Créer ${count} compte${count > 1 ? "s" : ""} et envoyer les courriels`, langDist: "Répartition des langues", sent: "Courriel envoyé", needsAttention: "À vérifier", exportResults: "Exporter les résultats",
  inv: { active: "Accès actif", temp_pending: "Mot de passe temporaire en attente", delivery_needs_attention: "Livraison à vérifier", revoked: "Accès révoqué" } as Record<string, string>,
  issuePassword: "Nouveau mot de passe temporaire", revoke: "Révoquer l'accès", confirmIssuePassword: "Émettre un nouveau mot de passe temporaire? L'ancien cessera de fonctionner immédiatement.", confirmRevoke: "Révoquer l'accès de cette personne à cette organisation? Son accès applicatif sera suspendu.", done: "C'est fait.",
  downloads: "Télécharger", desktop: "macOS / Bureau", ios: "iOS", android: "Android", notConfigured: "Lien non configuré",
  securityPage: ["Connexion par courriel et mot de passe seulement.", "Les mots de passe temporaires ne sont jamais affichés ni conservés dans le portail.", "Chaque personne choisit son mot de passe à la première connexion.", "L'accès applicatif est vérifié par le serveur et l'appartenance Lemtel."], support: "Contact de soutien",
  overviewStats: { orgs: "Organisations", people: "Personnes", pending: "Mots de passe temporaires" },
  signIn: "Se connecter", password: "Mot de passe", forgot: "Mot de passe oublié?", signInTitle: "Connexion à Lemtel", forgotTitle: "Recevoir un mot de passe temporaire", forgotBody: "Entrez votre courriel. Si un compte Lemtel existe, nous lui enverrons un nouveau mot de passe temporaire.", forgotSend: "Envoyer", forgotDone: "Si un compte Lemtel existe pour ce courriel, un mot de passe temporaire vient d'être envoyé.", backToSignIn: "Retour à la connexion", cooldown: (seconds: number) => `Réessayez dans ${seconds} s`, makeItYours: "Faites-le vôtre", createPwd: "Créez votre mot de passe personnel", newPwd: "Nouveau mot de passe", confirmPwd: "Confirmez le mot de passe", continue: "Continuer vers Lemtel", otherAccount: "Utiliser un autre compte", mismatch: "Les mots de passe ne correspondent pas.", strength: ["Très faible", "Faible", "Correct", "Fort", "Excellent"], strengthHint: "Au moins 12 caractères, avec majuscule, minuscule, chiffre et symbole.",
  errors: { temp_expired: "Demandez un nouveau mot de passe temporaire.", already_personalized: "Connectez-vous avec votre mot de passe personnel.", network: "Vérifiez votre connexion et réessayez.", unavailable: "Lemtel est temporairement indisponible. Réessayez sous peu.", invalid_credentials: "Courriel ou mot de passe incorrect.", not_allowed: "Votre compte n'a pas accès à cette action.", conflict: "Cet élément existe déjà.", invalid_input: "Vérifiez les champs indiqués.", throttled: "Trop de tentatives. Patientez un moment avant de réessayer.", readonly: "L'administration n'est pas activée sur ce portail.", generic: "Une erreur est survenue. Réessayez." } as Record<LemtelErrorKey, string>,
  mail: { subject: "Bienvenue chez Lemtel", hello: (name: string) => `Bonjour ${name},`, intro: (organization: string) => `Votre espace Lemtel pour ${organization} est prêt.`, username: "Nom d'utilisateur", tempPwd: "Mot de passe temporaire", tempPlaceholder: "(généré par le serveur au moment de l'envoi)", stepsTitle: "Première connexion", steps: ["Entrez votre courriel et le mot de passe temporaire.", "Créez votre mot de passe personnel.", "Accédez à votre espace Lemtel."], note: "Ne partagez jamais ce mot de passe temporaire. Changez-le dès votre première connexion.", getApps: "Télécharger Lemtel", supportLine: "Besoin d'aide? Écrivez-nous :" },
  activityActions: { organization_created: "Organisation créée", user_provisioned: "Compte créé", welcome_sent: "Courriel de bienvenue envoyé", welcome_failed: "Livraison du courriel à vérifier", welcome_resent: "Nouveau mot de passe temporaire émis", first_password_changed: "Mot de passe personnel choisi", user_access_suspended: "Accès suspendu" } as Record<string, string>,
};

const en: typeof fr = {
  brand: "Lemtel", tagline: "Private, intelligent communications",
  nav: { overview: "Overview", organizations: "Organizations", people: "People", invitations: "Access & invitations", devices: "Apps", security: "Security", activity: "Activity" },
  search: "Search", help: "Help", notifications: "Notifications", signOut: "Sign out", allOrgs: "All organizations",
  readonlyTitle: "Read-only mode", readonlyBody: "The Lemtel backend is not enabled for administration from this build. No change is sent.",
  empty: { orgs: "No organizations yet.", people: "No people in this organization.", invites: "No access records to manage.", activity: "No recent activity." },
  newOrg: "New organization", orgName: "Company / organization name", slug: "Address slug", slugHint: "Lowercase letters, numbers and hyphens.", defaultLang: "Default language", french: "Français", english: "English",
  adminName: "Owner full name", adminEmail: "Owner email", securityTitle: "What happens next",
  securityItems: ["The owner receives a welcome email.", "Their email address becomes their username.", "The server generates a temporary password.", "On first sign-in, they choose a personal password.", "Telephony settings remain server-side until they are provisioned."],
  create: "Create organization", cancel: "Cancel", back: "Back", next: "Next", previewEmail: "Email preview", orgCreated: "Organization created. The welcome email is handled by the server.",
  members: "members", pending: "pending", administrator: "Owner", health: "State", healthy: "Ready", inProgress: "Pending", attention: "Needs attention",
  invitePerson: "Add a person", firstName: "First name", lastName: "Last name", email: "Email (username)", language: "Language", role: "Role", roles: { owner: "Owner", admin: "Administrator", member: "Member" },
  invite: "Create and send", inviteSent: "The account was processed. The server is sending the welcome email.",
  bulk: "Bulk import", template: "Download CSV template", drop: "Drop a CSV file here or click to choose", headerError: "The file must include the first_name, last_name and email columns.",
  valid: "valid", warnings: "warnings", invalid: "invalid", line: "Line", issues: { missing_name: "Missing first or last name", invalid_email: "Invalid email", duplicate_email: "Duplicate email", invalid_language: "Invalid language (fr or en)", invalid_role: "Invalid role (admin or member)", language_inherited: "Organization language will be used" },
  confirmBulk: (count: number) => `Create ${count} account${count > 1 ? "s" : ""} and send emails`, langDist: "Language distribution", sent: "Email sent", needsAttention: "Needs attention", exportResults: "Export results",
  inv: { active: "Active access", temp_pending: "Temporary password pending", delivery_needs_attention: "Delivery needs attention", revoked: "Access revoked" },
  issuePassword: "New temporary password", revoke: "Revoke access", confirmIssuePassword: "Issue a new temporary password? The previous one stops working immediately.", confirmRevoke: "Revoke this person's access to this organization? Their app access will be suspended.", done: "Done.",
  downloads: "Download", desktop: "macOS / Desktop", ios: "iOS", android: "Android", notConfigured: "Link not configured",
  securityPage: ["Email and password sign-in only.", "Temporary passwords are never displayed or stored in the portal.", "Every person chooses their own password on first sign-in.", "App access is verified by the server and Lemtel membership."], support: "Support contact",
  overviewStats: { orgs: "Organizations", people: "People", pending: "Temporary passwords" },
  signIn: "Sign in", password: "Password", forgot: "Forgot password?", signInTitle: "Sign in to Lemtel", forgotTitle: "Get a temporary password", forgotBody: "Enter your email. If a Lemtel account exists, we will send it a new temporary password.", forgotSend: "Send", forgotDone: "If a Lemtel account exists for this email, a temporary password has just been sent.", backToSignIn: "Back to sign in", cooldown: (seconds: number) => `Try again in ${seconds}s`, makeItYours: "Make it yours", createPwd: "Create your personal password", newPwd: "New password", confirmPwd: "Confirm password", continue: "Continue to Lemtel", otherAccount: "Use another account", mismatch: "Passwords do not match.", strength: ["Very weak", "Weak", "Fair", "Strong", "Excellent"], strengthHint: "At least 12 characters, with uppercase, lowercase, number and symbol.",
  errors: { temp_expired: "Request a new temporary password.", already_personalized: "Sign in with your personal password.", network: "Check your connection and try again.", unavailable: "Lemtel is temporarily unavailable. Please try again shortly.", invalid_credentials: "Incorrect email or password.", not_allowed: "Your account does not have access to this action.", conflict: "This item already exists.", invalid_input: "Check the highlighted fields.", throttled: "Too many attempts. Please wait a moment before trying again.", readonly: "Administration is not enabled on this portal.", generic: "Something went wrong. Please try again." },
  mail: { subject: "Welcome to Lemtel", hello: (name: string) => `Hello ${name},`, intro: (organization: string) => `Your Lemtel workspace for ${organization} is ready.`, username: "Username", tempPwd: "Temporary password", tempPlaceholder: "(generated by the server at send time)", stepsTitle: "First sign-in", steps: ["Enter your email and temporary password.", "Create your personal password.", "Access your Lemtel workspace."], note: "Never share this temporary password. Change it on your first sign-in.", getApps: "Download Lemtel", supportLine: "Need help? Contact us:" },
  activityActions: { organization_created: "Organization created", user_provisioned: "Account created", welcome_sent: "Welcome email sent", welcome_failed: "Email delivery needs attention", welcome_resent: "New temporary password issued", first_password_changed: "Personal password selected", user_access_suspended: "Access suspended" },
};

export const LEMTEL_DICT = { fr, en };
export type LemtelDict = typeof fr;

export function useLemtelLang() {
  const [lang, setLang] = useState<Lang>(() => (typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "en" : "fr"));
  return { lang, setLang, t: LEMTEL_DICT[lang] };
}

export function passwordStrength(password: string): number {
  let strength = 0;
  if (password.length >= 12) strength += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength += 1;
  if (/\d/.test(password)) strength += 1;
  if (/[^A-Za-z0-9]/.test(password)) strength += 1;
  return password.length < 8 ? 0 : strength;
}
