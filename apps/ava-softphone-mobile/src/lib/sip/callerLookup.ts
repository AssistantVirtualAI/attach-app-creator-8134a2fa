/** Caller-ID lookup uses only the separately flagged Lemtel private directory. */
import { normalizePhone, formatDisplay } from '../phoneNormalize';
import { txStatic } from '../i18n';
import { invokeLemtelPrivateDirectory } from '../lemtelPrivateDirectory';

export interface CallerLookup {
  found: boolean;
  source: 'device' | 'maestro' | 'broker' | 'microsoft' | null;
  name: string;
  display_number: string;
  raw_number: string;
  phone_normalized: string | null;
  company?: string | null;
  photo_url?: string | null;
  email?: string | null;
  crm_meta?: { stage?: string; score?: number; tags?: any } | null;
  ms_meta?: { mobile?: string; business?: string[]; email?: string } | null;
}

const cache = new Map<string, { at: number; v: CallerLookup }>();
const TTL = 5 * 60 * 1000;

function isLemtelLookup(value: unknown): value is CallerLookup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.found === 'boolean' &&
    (candidate.source === 'device' || candidate.source === null) &&
    typeof candidate.name === 'string' &&
    typeof candidate.display_number === 'string' &&
    typeof candidate.raw_number === 'string' &&
    typeof candidate.phone_normalized === 'string';
}

export async function lookupCaller(rawNumber: string): Promise<CallerLookup> {
  const normalized = normalizePhone(rawNumber);
  const fallback: CallerLookup = {
    found: false,
    source: null,
    name: formatDisplay(normalized) || rawNumber || txStatic('Inconnu', 'Unknown'),
    display_number: formatDisplay(normalized) || rawNumber,
    raw_number: rawNumber,
    phone_normalized: normalized,
  };
  if (!normalized) return fallback;

  const hit = cache.get(normalized);
  if (hit && Date.now() - hit.at < TTL) return hit.v;

  const data = await invokeLemtelPrivateDirectory<CallerLookup>('lemtel-caller-lookup', { phone: normalized });
  if (!isLemtelLookup(data)) return fallback;
  cache.set(normalized, { at: Date.now(), v: data });
  return data;
}
