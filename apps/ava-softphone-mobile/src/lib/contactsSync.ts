// Device-contact synchronization remains disabled until a Lemtel-only service,
// privacy flow, and server contract have been approved. This module intentionally
// contains no historical endpoint, consent key, or legacy backend fallback.

export interface SyncReport {
  ok: boolean;
  inserted: number;
  total: number;
  skipped?: number;
  error?: string;
  ranAt: number;
}

const unavailable = (): SyncReport => ({
  ok: false,
  inserted: 0,
  total: 0,
  error: 'lemtel-contacts-service-not-configured',
  ranAt: Date.now(),
});

export async function getLastSync(): Promise<{ at: number | null; count: number | null }> {
  return { at: null, count: null };
}

export async function runContactsSync(_opts: { force?: boolean } = {}): Promise<SyncReport> {
  return unavailable();
}

/** No automatic contact synchronization runs in a canonical Lemtel build. */
export async function maybeRunDeltaSync(): Promise<SyncReport | null> {
  return null;
}
