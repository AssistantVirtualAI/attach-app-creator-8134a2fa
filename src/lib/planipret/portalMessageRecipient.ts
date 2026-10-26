import { normalizeSmsNumber } from "./smsAvailability";

export function isInternalMessageRecipient(value: string): boolean {
  return /^\d{2,6}$/.test(value.trim());
}

export function normalizePortalMessageRecipient(value: string): string | null {
  return isInternalMessageRecipient(value) ? value.trim() : normalizeSmsNumber(value);
}