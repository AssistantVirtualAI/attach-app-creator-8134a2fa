// Phase 31A — static contract: no network, provider API, Supabase or PBX access.
const dirname = new URL('.', import.meta.url);
const read = async (path: string) => Deno.readTextFile(new URL(path, dirname));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

Deno.test('TURN issuer requires a user JWT and a RLS-scoped softphone row', async () => {
  const source = await read('index.ts');
  check(source.includes('client.auth.getUser(jwt)'), 'missing JWT verification');
  check(source.includes(".eq('portal_user_id', user.id)"), 'missing own-row check');
  check(source.includes("errorResponse(401, 'auth_required')"), 'missing anonymous refusal');
  check(source.includes("errorResponse(403, 'softphone_access_required')"), 'missing non-softphone refusal');
  check(source.includes("'Cache-Control': 'no-store'"), 'TURN response can be cached');
  check(!/\bFALLBACK\b|credential\s*:\s*['\"]/.test(source), 'hard-coded relay credentials or fallback');
});

Deno.test('Lemtel mobile bundles do not contain a reusable TURN password', async () => {
  for (const path of [
    '../../../apps/ava-softphone-mobile/src/lib/sip/iceServers.ts',
    '../../../apps/ava-softphone-mobile/src/lib/sip/rtcConfig.ts',
  ]) {
    const source = await read(path);
    check(!/credential\s*:\s*['\"][^'\"]+['\"]/.test(source), `${path} contains a reusable TURN password`);
    check(!/VITE_TURN_CREDENTIAL/.test(source), `${path} permits embedding a TURN secret at build time`);
  }
});
