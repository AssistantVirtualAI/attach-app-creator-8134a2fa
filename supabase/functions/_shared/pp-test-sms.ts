// Garde-fou : les textos de test ne doivent jamais partir vers de vrais clients.
// Seuls Gilles et Marc (et l'admin technique) peuvent en envoyer / rejouer.

export const TEST_SMS_ALLOWED_USER_IDS = new Set<string>([
  "46f02fcf-340b-495c-8b1d-442c27dc092f", // Gilles Bouillon
  "a7df1872-f25a-4925-b763-a573e7452462", // Marc Alexandre Maglieri
  "e5d025c9-eef2-4422-b97d-3190388b7376", // Mohamad Hassoun (admin)
]);

const TEST_PATTERNS = [
  /^\s*test\b/i,
  /\btest\s*(sms|texto|text|qa|message)\b/i,
  /\bqa\s*(ava|test|\d)/i,
  /- ?ignorer\b/i,
  /\bignore this\b/i,
];

export function isTestSms(body: string | null | undefined): boolean {
  const t = String(body ?? "").trim();
  if (!t) return false;
  return TEST_PATTERNS.some((re) => re.test(t));
}

/** true = l'envoi doit être bloqué (texto de test hors Gilles/Marc). */
export function blockTestSms(userId: string | null | undefined, body: string | null | undefined): boolean {
  if (!isTestSms(body)) return false;
  return !userId || !TEST_SMS_ALLOWED_USER_IDS.has(userId);
}
