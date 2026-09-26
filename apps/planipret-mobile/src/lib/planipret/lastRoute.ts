// Remembers the last visited mobile page so a cold start of the app reopens
// where the broker left off instead of always landing on Home.
const KEY = "pp_last_route";

export function rememberLastRoute(path: string) {
  try {
    const clean = String(path ?? "").split(/[?#]/, 1)[0];
    if (clean.startsWith("/mplanipret") && !/\/ava/i.test(clean)) {
      localStorage.setItem(KEY, clean);
    }
  } catch { /* ignore */ }
}

export function lastRememberedRoute(): string | null {
  try {
    const p = localStorage.getItem(KEY);
    return p && p.startsWith("/mplanipret") ? p : null;
  } catch { return null; }
}
