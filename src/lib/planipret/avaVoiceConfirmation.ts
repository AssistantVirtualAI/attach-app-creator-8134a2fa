/**
 * Décision uniquement pour une réponse vocale courte et sans ambiguïté.
 * Toute autre phrase laisse la proposition en attente.
 */
export function voiceConfirmationDecision(value: unknown): "confirm" | "cancel" | null {
  const text = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  const words = text.split(" ");
  // Hesitation keeps the proposal pending.
  if (/\b(mais|attends|attend|minute|sais pas)\b/.test(text)) return null;
  // Any negation anywhere wins: "oui mais non", "non merci", "pas maintenant".
  if (/\b(non|no|nope|annule|annuler|arrete|stop|cancel|pas maintenant|ne le fais pas|laisse faire)\b/.test(text)) return "cancel";
  if (words.length > 6) return null;
  const yes = /^(oui|ouais|ouep|yep|yes|yeah|confirme|confirm|je confirme|vas y|go|d'accord|d accord|daccord|okay|ok|parfait|exact|exactement|correct|c'est correct|c est correct|absolument|certainement|bien sur|envoie|envoie le|fais le|sure)\b/;
  if (yes.test(text)) return "confirm";
  return null;
}
