/**
 * Maestro task catalog mirrored inside the mobile app.
 *
 * Maestro's "New Task" screen offers two tabs:
 *  - Quick Tasks: ready-made progress notes sent to the client/referral.
 *  - Custom Tasks: colour-coded milestones attached to the contract.
 * The labels and colours below match the Maestro web UI 1:1 so brokers see the
 * exact same list on iOS and Android.
 */

export interface TaskCatalogItem {
  id: string;
  fr: string;
  en: string;
  /** Milestone dot colour (custom tasks only). */
  color?: string;
}

/** Quick Tasks tab — one tap fills the progress note. */
export const QUICK_TASKS: TaskCatalogItem[] = [
  { id: "email_sent", fr: "J'ai envoyé un courriel au client", en: "I've sent an email to the client" },
  { id: "voicemail_left", fr: "J'ai laissé un message vocal au client", en: "I've left a voicemail to the client" },
  { id: "awaiting_response", fr: "J'ai parlé au client, en attente d'une réponse", en: "I've spoken with the client, awaiting a response" },
  { id: "meeting_scheduled", fr: "En contact avec le client, rencontre planifiée le", en: "In contact with the client with a meeting scheduled on" },
  { id: "docs_pending", fr: "Dossier en préparation, en attente de documents (voir notes)", en: "File currently being prepared, awaiting documents (see notes) to be placed" },
  { id: "presented_bank", fr: "Dossier présenté à la banque", en: "File has been presented at the bank" },
  { id: "file_closed", fr: "J'ai parlé au client. Dossier fermé (voir notes pour la raison)", en: "I spoke with the client. File has been closed. (See notes for reason)" },
  { id: "other", fr: "Autre", en: "Other" },
];

/** Custom Tasks tab — Maestro milestones with their colour codes. */
export const MILESTONES: TaskCatalogItem[] = [
  { id: "appraisal_follow_up", fr: "Suivi d'évaluation", en: "Appraisal Follow Up", color: "#6B6B6B" },
  { id: "awaiting_customer_decision", fr: "En attente de la décision du client", en: "Awaiting customer decision", color: "#F4D02B" },
  { id: "build_file_filogix", fr: "Monter le dossier dans Filogix", en: "Build file in on-line application/Filogix", color: "#6D28D9" },
  { id: "complete_commission_entry", fr: "Compléter l'entrée de commission", en: "Complete commission entry", color: "#A78BFA" },
  { id: "compliance", fr: "Conformité", en: "Compliance", color: "#FDE7CE" },
  { id: "create_contract_maestro", fr: "Créer le contrat dans Maestro", en: "Create contract in Maestro", color: "#12B76A" },
  { id: "file_cancelled_client", fr: "Dossier annulé par le client", en: "File cancelled by client", color: "#111827" },
  { id: "file_declined_lender", fr: "Dossier refusé par le prêteur", en: "File declined for credit or other reason by lender", color: "#1F2937" },
  { id: "follow_up_notary", fr: "Suivi avec le notaire", en: "Follow up with Notary", color: "#F5EF1E" },
  { id: "offer_creditor_insurance", fr: "Offrir assurance prêt Vie/ISC/MG", en: "Offer Creditor Insurance Life/DI/CI", color: "#0EA5E9" },
  { id: "offer_home_insurance", fr: "Offrir assurance habitation", en: "Offer Home Insurance", color: "#0EA5E9" },
  { id: "prepare_preapproval", fr: "Préparer une lettre de préautorisation", en: "Prepare a Pre-Approval Letter", color: "#AFA905" },
  { id: "prepare_lender_package", fr: "Préparer le dossier pour le prêteur", en: "Prepare document package for lender", color: "#F4551C" },
  { id: "recommendation_preparation", fr: "Préparation de la recommandation", en: "Recommendation preparation", color: "#2DD4BF" },
  { id: "request_documents", fr: "Demander des documents", en: "Request documents", color: "#0D9488" },
  { id: "screening_meeting", fr: "Rencontre de sélection", en: "Screening Meeting", color: "#FBA5D0" },
  { id: "send_consent_form", fr: "Envoyer le formulaire de consentement", en: "Send consent form", color: "#0B2E6B" },
  { id: "urgent", fr: "Urgent", en: "Urgent", color: "#F1274B" },
  { id: "waiting_final_approval", fr: "En attente de la lettre d'approbation finale", en: "Waiting for final approval letter", color: "#B91C1C" },
  { id: "waiting_lender", fr: "En attente du prêteur", en: "Waiting for lender", color: "#F59E0B" },
  { id: "waiting_reno_quote", fr: "En attente de la soumission de rénovation / Réno-Assistance", en: "Waiting for renovation quote/Offer Reno-Assistance", color: "#0EA5E9" },
  { id: "waiting_needs_analysis", fr: "En attente de l'analyse des besoins hypothécaires", en: "Waiting Mortgage Needs Analysis", color: "#84E64B" },
];

export const catalogLabel = (item: TaskCatalogItem, lang: "fr" | "en") => (lang === "en" ? item.en : item.fr);

/** Maestro colour names → swatch. */
const MAESTRO_COLORS: Record<string, string> = {
  blue: "#2563EB", clay: "#B45309", sun: "#FACC15", lilac: "#C4B5FD", aqua: "#22D3EE", sky: "#38BDF8",
  cream: "#FDE7CE", lime: "#84CC16", heather: "#A78BFA", orchid: "#DA70D6", bubblegum: "#F9A8D4",
  bumblebee: "#F5EF1E", geko: "#4ADE80", lawn: "#22C55E", black: "#111827", mint: "#6EE7B7",
  moss: "#65A30D", rose: "#FB7185", navy: "#1E3A8A", red: "#DC2626", crimson: "#B91C1C",
  yellow: "#FDE047", grotto: "#0E7490", cobalt: "#1D4ED8", ash: "#9CA3AF", forest: "#166534",
};

/**
 * Builds the Custom Tasks list from the broker's own Maestro tasks
 * (description + colour), most used first. Each broker has their own
 * milestones in Maestro, so a fixed list never matches.
 */
export function brokerMilestones(rows: Array<{ description?: unknown; color?: unknown }>, max = 60): TaskCatalogItem[] {
  const seen = new Map<string, { label: string; color?: string; n: number }>();
  for (const r of rows) {
    const label = String(r.description ?? "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 120) continue;
    const key = label.toLocaleLowerCase("fr");
    const color = MAESTRO_COLORS[String(r.color ?? "").toLowerCase()];
    const cur = seen.get(key);
    if (cur) { cur.n++; if (!cur.color && color) cur.color = color; }
    else seen.set(key, { label, color, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "fr")).slice(0, max)
    .map((m, i) => ({ id: `maestro_${i}`, fr: m.label, en: m.label, color: m.color }));
}
