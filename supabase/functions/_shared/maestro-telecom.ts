// Shared helper for calling the Maestro Telecom REST API from Planiprêt edge
// functions. Config is stored in `planipret_integration_secrets` under provider
// `maestro_telecom` and falls back to env vars for local development.
//
// This module intentionally never throws on missing config — callers use it
// in fire-and-forget flows where NS-API remains the source of truth.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface MaestroTelecomConfig {
  url: string;   // e.g. https://client-dev.planipret.com/telecom/api/v1 (no trailing slash)
  key: string;   // machine API key (Bearer)
}

export interface MaestroTelecomResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
}

let cachedConfig: { at: number; cfg: MaestroTelecomConfig } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getMaestroTelecomConfig(admin: SupabaseClient): Promise<MaestroTelecomConfig> {
  if (cachedConfig && Date.now() - cachedConfig.at < CACHE_TTL_MS) return cachedConfig.cfg;

  let apiUrl = "";
  let apiKey = "";
  try {
    const { data } = await admin
      .from("planipret_integration_secrets")
      .select("config")
      .eq("provider", "maestro_telecom")
      .maybeSingle();
    const c = (data?.config ?? {}) as Record<string, string>;
    apiUrl = c.api_url ?? "";
    apiKey = c.api_key ?? "";
  } catch { /* fall through to env */ }

  const cfg: MaestroTelecomConfig = {
    url: (apiUrl || Deno.env.get("MAESTRO_TELECOM_BASE_URL") || Deno.env.get("MAESTRO_TELECOM_API_URL") || "").replace(/\/$/, ""),
    key: apiKey || Deno.env.get("MAESTRO_TELECOM_API_KEY") || "",
  };
  cachedConfig = { at: Date.now(), cfg };
  return cfg;
}

export function isMaestroTelecomConfigured(cfg: MaestroTelecomConfig): boolean {
  return Boolean(cfg.url && cfg.key);
}

export async function maestroTelecomFetch<T = any>(
  cfg: MaestroTelecomConfig,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<MaestroTelecomResult<T>> {
  if (!isMaestroTelecomConfigured(cfg)) return { ok: false, status: 0, data: null };
  const url = `${cfg.url}${path.startsWith("/") ? path : `/${path}`}${path.includes("?") ? "&" : "?"}machine=1`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "Authorization": `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    console.warn("[maestro-telecom]", (e as Error)?.message ?? e);
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Best-effort mirror to Maestro. Never throws, never blocks the caller.
 * Use for duplicating side-effects (SMS sent, call started, call ended) that
 * NS-API already persisted authoritatively.
 */
export function maestroTelecomMirror(
  admin: SupabaseClient,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): void {
  void (async () => {
    try {
      const cfg = await getMaestroTelecomConfig(admin);
      if (!isMaestroTelecomConfigured(cfg)) return;
      await maestroTelecomFetch(cfg, path, opts);
    } catch (e) {
      console.warn("[maestro-telecom.mirror]", (e as Error)?.message ?? e);
    }
  })();
}

/**
 * Load the current broker's Maestro user id from `planipret_profiles`. Returns
 * null if the broker hasn't been linked to Maestro yet — callers should skip
 * the Maestro flow silently in that case.
 */
export async function getMaestroBrokerId(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from("planipret_profiles")
      .select("maestro_broker_id")
      .eq("user_id", userId)
      .maybeSingle();
    const id = (data as any)?.maestro_broker_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
