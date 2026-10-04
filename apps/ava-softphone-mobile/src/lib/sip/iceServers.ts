import { BACKEND_URL, BACKEND_ANON_KEY } from '../backendOrigin';
import { supabase } from '../mobileSupabase';

// TURN credentials must be fetched at call time for the active account.
// STUN-only degradation may not traverse restrictive NAT: do not ship a new
// native build until the authorized TURN issuer has passed real-device tests.
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let cache: { at: number; userId: string; servers: RTCIceServer[] } | null = null;
const TTL_MS = 5 * 60 * 1000;
const INCOMING_CALL_BUDGET_MS = 1_200;

export function clearIceServerCache(): void { cache = null; }

export async function fetchIceServers(timeoutMs = INCOMING_CALL_BUDGET_MS): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RTCIceServer[]>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(FALLBACK_ICE_SERVERS); }, timeoutMs);
  });
  const attempt = fetchIceServersBeforeDeadline(controller.signal).catch(() => FALLBACK_ICE_SERVERS);
  try { return await Promise.race([attempt, deadline]); }
  finally { if (timer) clearTimeout(timer); }
}

async function fetchIceServersBeforeDeadline(signal: AbortSignal): Promise<RTCIceServer[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (signal.aborted) return FALLBACK_ICE_SERVERS;
  const userId = session?.user?.id;
  if (!userId || !session?.access_token) { clearIceServerCache(); return FALLBACK_ICE_SERVERS; }
  if (cache && cache.userId === userId && Date.now() - cache.at < TTL_MS) return cache.servers;
  clearIceServerCache();
  try {
    const res = await fetch(`${BACKEND_URL}/functions/v1/get-turn-credentials`, {
      headers: {
        apikey: BACKEND_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      signal,
    });
    if (res.ok && !signal.aborted) {
      const servers = (await res.json()) as RTCIceServer[];
      if (!signal.aborted && Array.isArray(servers) && servers.length) {
        cache = { at: Date.now(), userId, servers };
        return servers;
      }
    }
  } catch {
    // No static TURN password: calls on restricted networks must wait for
    // a working, authenticated server-issued relay credential.
  }
  return FALLBACK_ICE_SERVERS;
}
