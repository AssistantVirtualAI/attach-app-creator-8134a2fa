// One build-time API origin per Lemtel client. Do not mix managed and self-hosted credentials.
// Existing installs keep their current origin until a separate, reviewed cutover build.
export const LEGACY_BACKEND_URL = 'https://gejxisrqtvxavbrfcoxz.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdlanhpc3JxdHZ4YXZicmZjb3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDMxNzQsImV4cCI6MjA3NzA3OTE3NH0.kaO-GslE99OCNrZ4_AMnbzGqya2azqz_UMZR34zZvvo';

export function resolveBackendOrigin(raw: unknown, publicKey: unknown): string {
  if (raw == null || raw === '') return LEGACY_BACKEND_URL;
  if (typeof raw !== 'string') throw new Error('Invalid Lemtel backend URL');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid Lemtel backend URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Lemtel backend requires a bare HTTPS origin');
  }
  if (parsed.origin !== LEGACY_BACKEND_URL &&
      (typeof publicKey !== 'string' || !publicKey.trim() || publicKey === LEGACY_PUBLISHABLE_KEY)) {
    throw new Error('A new publishable key is required for a new Lemtel backend origin');
  }
  return parsed.origin;
}

export function resolveBackendConfig(env: Record<string, unknown>): { url: string; key: string; storageSuffix: string } {
  const explicitKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // The legacy ANON env var is compatible only with the historical origin.
  const tentative = resolveBackendOrigin(env.VITE_SUPABASE_URL,
    explicitKey || (env.VITE_SUPABASE_URL ? undefined : env.VITE_SUPABASE_ANON_KEY));
  const cutover = tentative !== LEGACY_BACKEND_URL;
  const chosen = cutover ? explicitKey : (explicitKey || env.VITE_SUPABASE_ANON_KEY || LEGACY_PUBLISHABLE_KEY);
  if (typeof chosen !== 'string' || !chosen.trim()) throw new Error('Missing Lemtel publishable key');
  return { url: tentative, key: chosen, storageSuffix: cutover ? `:${encodeURIComponent(tentative)}` : '' };
}

const resolved = resolveBackendConfig((import.meta as any).env ?? {});
export const BACKEND_URL = resolved.url;
export const BACKEND_ANON_KEY = resolved.key;
export const BACKEND_STORAGE_SUFFIX = resolved.storageSuffix;

export function resolveResetRedirect(backendUrl: string, raw: unknown): string {
  if (backendUrl === LEGACY_BACKEND_URL) return 'https://avastatistic.ca/reset-password';
  if (typeof raw !== 'string') throw new Error('Configurez une URL HTTPS de réinitialisation Lemtel.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('URL de réinitialisation Lemtel invalide.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/reset-password') throw new Error('URL de réinitialisation Lemtel invalide.');
  return parsed.href;
}

export const getResetRedirect = () => resolveResetRedirect(BACKEND_URL,
  ((import.meta as any).env ?? {}).VITE_LEMTEL_AUTH_REDIRECT_URL);
