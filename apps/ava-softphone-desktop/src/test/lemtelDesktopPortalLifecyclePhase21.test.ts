// Lemtel Phase 21B — Desktop-local static checks (no Git, no network, no telephony).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(__dirname, '..');
const rd = (p: string) => fs.readFileSync(path.join(src, p), 'utf8');

describe('Lemtel Phase 21B — Desktop lifecycle (local)', () => {
  it('pure module enforces the desktop policy and the 900 s minimum', () => {
    const s = rd('lib/lemtelDesktopClientConfig.ts');
    expect(s).toContain("if (m.access.desktopEnabled !== true) return 'blocked_desktop_access'");
    expect(s).toContain('m.routing.edgeFeatureGate !== false');
    expect(s).toContain('MIN_REFRESH_SECONDS = 900');
    expect(s).not.toMatch(/setTimeout|setInterval|\bfetch\(|WebSocket|console\./);
  });

  it('hook only calls lemtel-client-config, has no legacy mode', () => {
    const s = rd('hooks/useLemtelDesktopClientConfig.ts');
    expect(s).toContain("const FN = 'lemtel-client-config'");
    expect(s).not.toMatch(/legacy|softphone-credentials|setInterval|console\./);
  });

  it('App gates SipKeepAlive, CDR and background sync behind the manifest', () => {
    const s = rd('App.tsx');
    expect(s.indexOf('useLemtelDesktopClientConfig(')).toBeLessThan(s.indexOf('<SipKeepAlive creds={creds}'));
    expect(s).toContain('{lifecycleAllowed && <AllowedCdrSync />}');
    expect(s).toContain('{lifecycleAllowed && <DesktopBackgroundSync');
    expect(s).toContain("supabase.auth.signOut({ scope: 'local' })");
  });

  it('useSoftphone exposes allowNewActions defaulting to true', () => {
    expect(rd('hooks/useSoftphone.ts')).toContain('const allowNewActions = args.allowNewActions !== false;');
  });
});
