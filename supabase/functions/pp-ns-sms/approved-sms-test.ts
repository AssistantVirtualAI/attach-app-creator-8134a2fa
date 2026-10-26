// Explicitly approved single test; fail closed for every other request.
export const APPROVED_SMS_TEST_KEY = "approved-cell-sms-2026-10-26-2302";
export const APPROVED_SMS_TEST_BODY = "Message de test SMS Planiprêt autorisé. Merci de confirmer la réception.";
export function approvedSmsTest(userId: string, to: string, body: string, key: string | null, now = Date.now()): boolean {
  const digits = to.replace(/\D/g, "");
  return userId === "e5d025c9-eef2-4422-b97d-3190388b7376"
    && (digits === "5142163359" || digits === "15142163359")
    && body === APPROVED_SMS_TEST_BODY
    && key === APPROVED_SMS_TEST_KEY
    && now < Date.parse("2026-10-26T23:20:00Z");
}