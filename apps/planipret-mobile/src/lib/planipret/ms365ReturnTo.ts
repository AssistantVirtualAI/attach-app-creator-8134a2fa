/**
 * Safe return destination after the Microsoft 365 connect flow.
 * Only a strict whitelist of internal Planiprêt paths is ever stored or returned.
 * Anything else (full URL, protocol, host, traversal, other paths, malformed storage)
 * falls back to the home screen.
 */
const KEY = "pp_ms365_return_to_v1";
const MAX_AGE_MS = 30 * 60 * 1000;
export const MS365_RETURN_FALLBACK = "/mplanipret/home";
export const MS365_RETURN_WHITELIST = [
  "/mplanipret/more",
  "/mplanipret/connections",
  "/mplanipret/ms365-diagnostics",
] as const;

export function sanitizeMs365ReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  if (!/^\/[a-z0-9/-]+$/.test(value)) return null;
  if (value.includes("//") || value.includes("..")) return null;
  return (MS365_RETURN_WHITELIST as readonly string[]).includes(value) ? value : null;
}

export function rememberMs365ReturnTo(pathname: string | null | undefined, now: number = Date.now()): void {
  try {
    const safe = sanitizeMs365ReturnTo(pathname);
    if (!safe) { localStorage.removeItem(KEY); return; }
    localStorage.setItem(KEY, JSON.stringify({ path: safe, at: now }));
  } catch { /* ignore */ }
}

/** Reads, validates and clears the stored destination. Always returns a safe internal path. */
export function consumeMs365ReturnTo(now: number = Date.now()): string {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (!raw) return MS365_RETURN_FALLBACK;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.at !== "number") return MS365_RETURN_FALLBACK;
    if (now - parsed.at > MAX_AGE_MS || parsed.at > now + 60_000) return MS365_RETURN_FALLBACK;
    return sanitizeMs365ReturnTo(parsed.path) ?? MS365_RETURN_FALLBACK;
  } catch {
    return MS365_RETURN_FALLBACK;
  }
}

export function clearMs365ReturnTo(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
