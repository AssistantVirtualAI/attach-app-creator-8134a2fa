// One immutable, build-time API origin per Lemtel client.
// All Lemtel mobile builds must explicitly use the active-passive canonical route.
// There is deliberately no managed-backend fallback: a missing or different origin
// fails the build instead of silently routing an installed client elsewhere.
export const LEMTEL_CANONICAL_BACKEND_URL = 'https://lemtel.assistantvirtualai.com';

function requireCanonicalOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Lemtel canonical backend URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid Lemtel backend URL');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      parsed.origin !== LEMTEL_CANONICAL_BACKEND_URL) {
    throw new Error('Lemtel canonical backend URL is required');
  }

  return parsed.origin;
}

export function resolveBackendOrigin(raw: unknown, publicKey: unknown): string {
  const origin = requireCanonicalOrigin(raw);
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    throw new Error('Lemtel publishable key is required');
  }
  return origin;
}

export function resolveBackendConfig(env: Record<string, unknown>): { url: string; key: string; storageSuffix: string } {
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = resolveBackendOrigin(env.VITE_SUPABASE_URL, key);
  return { url, key: String(key).trim(), storageSuffix: `:${encodeURIComponent(url)}` };
}

function buildEnvironment(): Record<string, unknown> {
  const vite = ((import.meta as any).env ?? {}) as Record<string, unknown>;
  // Vitest imports modules that do not themselves exercise configuration. A
  // canonical-only test fixture keeps those unit tests isolated while a browser
  // build still fails closed whenever its required environment is absent.
  if (vite.MODE === 'test') {
    return {
      VITE_SUPABASE_URL: LEMTEL_CANONICAL_BACKEND_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_vitest_fixture',
      VITE_LEMTEL_AUTH_REDIRECT_URL: `${LEMTEL_CANONICAL_BACKEND_URL}/reset-password`,
      ...vite,
      ...(typeof process === 'undefined' ? {} : process.env),
    };
  }
  return vite;
}

const resolved = resolveBackendConfig(buildEnvironment());
export const BACKEND_URL = resolved.url;
export const BACKEND_ANON_KEY = resolved.key;
export const BACKEND_STORAGE_SUFFIX = resolved.storageSuffix;

export function resolveResetRedirect(backendUrl: string, raw: unknown): string {
  if (backendUrl !== LEMTEL_CANONICAL_BACKEND_URL || typeof raw !== 'string') {
    throw new Error('Configurez une URL HTTPS de réinitialisation Lemtel.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL de réinitialisation Lemtel invalide.');
  }

  if (parsed.href !== `${LEMTEL_CANONICAL_BACKEND_URL}/reset-password`) {
    throw new Error('URL de réinitialisation Lemtel invalide.');
  }

  return parsed.href;
}

export const getResetRedirect = () => resolveResetRedirect(BACKEND_URL,
  ((import.meta as any).env ?? {}).VITE_LEMTEL_AUTH_REDIRECT_URL);
