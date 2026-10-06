// Separate from the historical Planipret consent: this source stays inert until
// a future self-hosted Lemtel build explicitly enables the private directory.
import { Preferences } from '@capacitor/preferences';
import { BACKEND_STORAGE_SUFFIX, BACKEND_URL } from './backendOrigin';
import { deleteLemtelDeviceContacts, isLemtelPrivateDirectoryEnabled } from './lemtelPrivateDirectory';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const VERSION = 'lemtel-private-contacts-v1';
const PREFIX = `lemtel.private.contacts.consent.v1${BACKEND_STORAGE_SUFFIX}:`;

export type LemtelPrivateContactsConsent = {
  given: boolean;
  timestamp: string;
  version: typeof VERSION;
  origin: string;
  userId: string;
};

function validUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && UUID_RE.test(userId);
}

export function lemtelPrivateContactsConsentKey(userId: string): string | null {
  return isLemtelPrivateDirectoryEnabled() && validUserId(userId) ? `${PREFIX}${userId.toLowerCase()}` : null;
}

export function isValidLemtelPrivateContactsConsent(value: unknown, userId: string): value is LemtelPrivateContactsConsent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.given === 'boolean' && typeof record.timestamp === 'string' &&
    record.version === VERSION && record.origin === BACKEND_URL && record.userId === userId.toLowerCase();
}

export async function loadLemtelPrivateContactsConsent(userId: string): Promise<LemtelPrivateContactsConsent | null> {
  const key = lemtelPrivateContactsConsentKey(userId);
  if (!key) return null;
  try {
    const { value } = await Preferences.get({ key });
    const parsed = value ? JSON.parse(value) : null;
    return isValidLemtelPrivateContactsConsent(parsed, userId) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setLemtelPrivateContactsConsent(userId: string, given: boolean): Promise<boolean> {
  const key = lemtelPrivateContactsConsentKey(userId);
  if (!key) return false;
  const record: LemtelPrivateContactsConsent = {
    given,
    timestamp: new Date().toISOString(),
    version: VERSION,
    origin: BACKEND_URL,
    userId: userId.toLowerCase(),
  };
  try {
    await Preferences.set({ key, value: JSON.stringify(record) });
    return true;
  } catch {
    return false;
  }
}

export async function revokeLemtelPrivateContactsConsent(userId: string): Promise<boolean> {
  const key = lemtelPrivateContactsConsentKey(userId);
  if (!key) return false;
  try {
    await Preferences.remove({ key });
    return true;
  } catch {
    return false;
  }
}

/** Server deletion occurs before the local consent record is removed. */
export async function deleteLemtelDeviceContactsAndRevoke(userId: string): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  if (!lemtelPrivateContactsConsentKey(userId)) return { ok: false, error: 'lemtel-private-directory-disabled' };
  const deleted = await deleteLemtelDeviceContacts();
  if (deleted === null) return { ok: false, error: 'lemtel-contacts-delete-failed' };
  if (!(await revokeLemtelPrivateContactsConsent(userId))) return { ok: false, error: 'lemtel-contacts-local-revoke-failed' };
  return { ok: true, deleted };
}
