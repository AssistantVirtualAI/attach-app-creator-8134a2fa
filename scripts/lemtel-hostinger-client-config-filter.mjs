import crypto from 'node:crypto';

export const HOSTINGER_ORIGIN = 'https://lemtel.avastatistic.ca';
export const HOSTINGER_ANON_KEY_SHA256_16 = 'aa5b9711b893de44';
const LEGACY_ORIGIN = 'https://gejxisrqtvxavbrfcoxz.supabase.co';

export function validateHostingerLemtelConfig(env) {
  const fail = (reason) => ({ ok: false, reason });
  if (env.VITE_LEMTEL_TARGET !== 'hostinger-staging') return fail('TARGET_MUST_BE_HOSTINGER_STAGING');
  if (env.VITE_SUPABASE_URL !== HOSTINGER_ORIGIN) return fail('ORIGIN_MUST_BE_EXACT_HOSTINGER_LEMTEL');
  if (env.VITE_SUPABASE_URL === LEGACY_ORIGIN || /planipret/i.test(String(env.VITE_SUPABASE_URL))) return fail('PLANIPRET_ORIGIN_DENIED');
  if (env.VITE_LEMTEL_PRIVATE_DIRECTORY !== 'approved') return fail('PRIVATE_DIRECTORY_FLAG_REQUIRED');
  if (env.VITE_LEMTEL_EMAIL_ONLY_SIGNIN !== 'approved') return fail('EMAIL_ONLY_SIGNIN_FLAG_REQUIRED');
  if (env.VITE_LEMTEL_AUTH_REDIRECT_URL !== `${HOSTINGER_ORIGIN}/reset-password`) return fail('RESET_REDIRECT_MUST_BE_HOSTINGER');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !key.trim() || key.includes('__INJECT_')) return fail('HOSTINGER_PUBLISHABLE_KEY_REQUIRED');
  if (crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) !== HOSTINGER_ANON_KEY_SHA256_16) return fail('HOSTINGER_PUBLISHABLE_KEY_FINGERPRINT_MISMATCH');
  return { ok: true, origin: HOSTINGER_ORIGIN, target: 'hostinger-staging' };
}

if (process.argv[1]?.endsWith('lemtel-hostinger-client-config-filter.mjs')) {
  const result = validateHostingerLemtelConfig(process.env);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 78;
}
