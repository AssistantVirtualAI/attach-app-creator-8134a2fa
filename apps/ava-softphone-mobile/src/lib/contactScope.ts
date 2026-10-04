import { BACKEND_URL, LEGACY_BACKEND_URL } from './backendOrigin';

// Phase 31D: the historical consent/cache/server upload are coupled to the
// shared backend. Do not carry them into a new Lemtel issuer. Local-only device
// contacts will require a distinct, origin-and-account-scoped consent flow.
export const LEGACY_CONTACTS_ENABLED = BACKEND_URL === LEGACY_BACKEND_URL;
