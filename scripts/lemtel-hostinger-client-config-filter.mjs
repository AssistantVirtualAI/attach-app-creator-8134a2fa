import crypto from 'node:crypto';

export const LEMTEL_CANONICAL_ORIGIN = 'https://lemtel.assistantvirtualai.com';
export const LEMTEL_ACTIVE_PASSIVE_TARGET = 'lemtel-active-passive';
export const LEMTEL_ANON_KEY_SHA256_16 = 'aa5b9711b893de44';
const LEGACY_ORIGIN = 'https://gejxisrqtvxavbrfcoxz.supabase.co';

export function validateLemtelActivePassiveConfig(env) {
  const fail = (reason) => ({ ok: false, reason });
  if (env.VITE_LEMTEL_TARGET !== LEMTEL_ACTIVE_PASSIVE_TARGET) return fail('TARGET_MUST_BE_LEMTEL_ACTIVE_PASSIVE');
  if (env.VITE_LEMTEL_API_URL !== LEMTEL_CANONICAL_ORIGIN) return fail('ORIGIN_MUST_BE_EXACT_CANONICAL_LEMTEL');
  if (env.VITE_LEMTEL_API_URL === LEGACY_ORIGIN || /planipret/i.test(String(env.VITE_LEMTEL_API_URL))) return fail('PLANIPRET_ORIGIN_DENIED');
  if (env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY) return fail('GENERIC_RUNTIME_KEYS_DENIED');
  if (env.VITE_LEMTEL_PRIVATE_DIRECTORY !== 'approved') return fail('PRIVATE_DIRECTORY_FLAG_REQUIRED');
  if (env.VITE_LEMTEL_EMAIL_ONLY_SIGNIN !== 'approved') return fail('EMAIL_ONLY_SIGNIN_FLAG_REQUIRED');
  if (env.VITE_LEMTEL_HOSTED_ONBOARDING !== 'approved') return fail('HOSTED_ONBOARDING_FLAG_REQUIRED');
  if (env.VITE_LEMTEL_AUTH_REDIRECT_URL !== `${LEMTEL_CANONICAL_ORIGIN}/reset-password`) return fail('RESET_REDIRECT_MUST_BE_CANONICAL');
  const key = env.VITE_LEMTEL_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !key.trim() || key.includes('__INJECT_')) return fail('LEMTEL_PUBLISHABLE_KEY_REQUIRED');
  if (crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) !== LEMTEL_ANON_KEY_SHA256_16) return fail('LEMTEL_PUBLISHABLE_KEY_FINGERPRINT_MISMATCH');
  return { ok: true, origin: LEMTEL_CANONICAL_ORIGIN, target: LEMTEL_ACTIVE_PASSIVE_TARGET };
}

if (process.argv[1]?.endsWith('lemtel-hostinger-client-config-filter.mjs')) {
  const result = validateLemtelActivePassiveConfig(process.env);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 78;
}
