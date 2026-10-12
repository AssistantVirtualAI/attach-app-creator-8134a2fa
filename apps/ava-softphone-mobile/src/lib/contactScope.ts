import { BACKEND_URL, LEMTEL_CANONICAL_BACKEND_URL } from './backendOrigin';
import { isLemtelPrivateDirectoryEnabled } from './lemtelPrivateDirectory';

// Historical consent/cache/server upload are deliberately unavailable to the
// canonical Lemtel build. Device contacts require the dedicated Lemtel path.
export const LEGACY_CONTACTS_ENABLED = false;

// A separate self-hosted Lemtel build must opt in explicitly. Current builds
// leave this false, preserving the legacy consent, cache and upload boundary.
export const LEMTEL_PRIVATE_CONTACTS_UI_ENABLED =
  BACKEND_URL === LEMTEL_CANONICAL_BACKEND_URL && isLemtelPrivateDirectoryEnabled();
