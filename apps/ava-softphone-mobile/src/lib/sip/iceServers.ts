// Fetches fresh ICE servers (STUN/TURN) from the Supabase edge function
// `get-turn-credentials`, which proxies the Metered API. Falls back to
// known-good hardcoded TURN creds on failure so calls can still connect.

const SUPABASE_URL = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdlanhpc3JxdHZ4YXZicmZjb3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDMxNzQsImV4cCI6MjA3NzA3OTE3NH0.kaO-GslE99OCNrZ4_AMnbzGqya2azqz_UMZR34zZvvo';

export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: 'turn:global.relay.metered.ca:443?transport=tcp',
    username: 'e499486ca9b7d5a03a01e915',
    credential: 'uMFpNAFBoFFUHOdF',
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: 'e499486ca9b7d5a03a01e915',
    credential: 'uMFpNAFBoFFUHOdF',
  },
];

let cache: { at: number; servers: RTCIceServer[] } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 min

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.servers;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-turn-credentials`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (res.ok) {
      const servers = (await res.json()) as RTCIceServer[];
      if (Array.isArray(servers) && servers.length) {
        cache = { at: Date.now(), servers };
        return servers;
      }
    }
  } catch (e) {
    console.warn('[iceServers] fetch failed, using fallback', e);
  }
  return FALLBACK_ICE_SERVERS;
}
