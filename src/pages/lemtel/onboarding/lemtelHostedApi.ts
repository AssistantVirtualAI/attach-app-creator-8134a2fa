// Lemtel-only client for the authoritative self-hosted Lemtel backend.
// Never imports the Planipret/Cloud client. Session is kept in memory only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (import.meta as any).env ?? {};
export const LEMTEL_API_URL: string = String(env.VITE_LEMTEL_API_URL ?? "").replace(/\/+$/, "");
const LEMTEL_ANON_KEY: string = String(env.VITE_LEMTEL_ANON_KEY ?? "");
/** Explicit flag: onboarding writes are allowed only when this is "true". */
export const LEMTEL_ONBOARDING_ENABLED =
  String(env.VITE_LEMTEL_HOSTED_ONBOARDING ?? "") === "true" && !!LEMTEL_API_URL && !!LEMTEL_ANON_KEY;
export const LEMTEL_BACKEND_CONFIGURED = !!LEMTEL_API_URL && !!LEMTEL_ANON_KEY;

const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); },
};

let client: SupabaseClient | null = null;
export function lemtelClient(): SupabaseClient | null {
  if (!LEMTEL_BACKEND_CONFIGURED) return null;
  if (!client) {
    client = createClient(LEMTEL_API_URL, LEMTEL_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storage: memoryStorage, storageKey: "lemtel-portal-mem" },
    });
  }
  return client;
}

export type LemtelErrorKey =
  | "temp_expired" | "already_personalized" | "network" | "unavailable" | "invalid_credentials"
  | "not_allowed" | "conflict" | "invalid_input" | "throttled" | "readonly" | "generic";

export class LemtelError extends Error {
  constructor(public key: LemtelErrorKey) { super(key); }
}

/** Map any backend/HTTP failure to a safe, user-facing key. Never surfaces raw text. */
export function toLemtelErrorKey(code: unknown, status?: number): LemtelErrorKey {
  const c = String(code ?? "").toLowerCase();
  if (c.includes("expired")) return "temp_expired";
  if (c.includes("already") && (c.includes("personal") || c.includes("changed"))) return "already_personalized";
  if (c.includes("invalid_credentials") || c.includes("invalid login")) return "invalid_credentials";
  if (c.includes("throttl") || c.includes("rate") || status === 429) return "throttled";
  if (c.includes("exists") || c.includes("duplicate") || c.includes("conflict") || status === 409) return "conflict";
  if (c.includes("invalid") || status === 400 || status === 422) return "invalid_input";
  if (c.includes("forbidden") || c.includes("not_allowed") || status === 401 || status === 403) return "not_allowed";
  if (c.includes("failed to fetch") || c.includes("network")) return "network";
  if ((status ?? 0) >= 500 || c.includes("unavailable")) return "unavailable";
  return "generic";
}

async function post(fn: string, body: unknown, auth = true): Promise<any> {
  if (!LEMTEL_BACKEND_CONFIGURED) throw new LemtelError("readonly");
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: LEMTEL_ANON_KEY };
  if (auth) {
    const { data } = await lemtelClient()!.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new LemtelError("not_allowed");
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Authorization = `Bearer ${LEMTEL_ANON_KEY}`;
  }
  let res: Response;
  try {
    res = await fetch(`${LEMTEL_API_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new LemtelError(typeof navigator !== "undefined" && navigator.onLine === false ? "network" : "unavailable");
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok || data?.ok === false || data?.error) {
    throw new LemtelError(toLemtelErrorKey(data?.error ?? data?.code, res.status));
  }
  return data ?? {};
}

/** Single server-side action for every onboarding write/read. */
export async function onboarding<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const write = !action.startsWith("list_") && action !== "get_config";
  if (write && !LEMTEL_ONBOARDING_ENABLED) throw new LemtelError("readonly");
  return post("lemtel-onboarding-admin", { action, payload });
}

/** Privacy-preserving reset request: always resolves unless throttled/offline. */
export async function requestTemporaryPassword(email: string): Promise<void> {
  try {
    await post("lemtel-password-reset-request", { email: email.trim().toLowerCase() }, false);
  } catch (e) {
    const k = e instanceof LemtelError ? e.key : "generic";
    if (k === "throttled" || k === "network" || k === "unavailable" || k === "readonly") throw e;
    // Unknown email / other states → same generic confirmation.
  }
}
