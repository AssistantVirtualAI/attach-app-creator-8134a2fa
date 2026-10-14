import { createClient } from "npm:@supabase/supabase-js@2";
/** Reuse identical AI insight answers for 6h: same input → no new Claude call. */
export const DEFAULT_INSIGHTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export async function insightsCacheKey(label: string, input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${label}\n${input}`));
  return `${label}:` + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readInsightsCache(key: string, ttlMs = DEFAULT_INSIGHTS_CACHE_TTL_MS): Promise<unknown | null> {
  try {
    const { data } = await admin().from("ai_insights_cache").select("payload, created_at").eq("cache_key", key).maybeSingle();
    if (!data || Date.now() - new Date(data.created_at).getTime() > ttlMs) return null;
    return data.payload;
  } catch { return null; }
}

export async function writeInsightsCache(key: string, payload: unknown): Promise<void> {
  try {
    await admin().from("ai_insights_cache").upsert({ cache_key: key, payload, created_at: new Date().toISOString() });
  } catch { /* cache is best-effort */ }
}
