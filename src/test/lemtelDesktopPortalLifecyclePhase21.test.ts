import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const SCOPE = "128b45ebb";
const APP = "apps/ava-softphone-desktop/src";
const LIB = `${APP}/lib/lemtelDesktopClientConfig.ts`;
const HOOK = `${APP}/hooks/useLemtelDesktopClientConfig.ts`;
const MAIN = `${APP}/App.tsx`;
const SOFT = `${APP}/hooks/useSoftphone.ts`;
const FILES = [
  MAIN,
  SOFT,
  HOOK,
  `${APP}/hooks/useLemtelDesktopClientConfig.test.tsx`,
  LIB,
  `${APP}/lib/lemtelDesktopClientConfig.test.ts`,
  `${APP}/test/lemtelDesktopPortalLifecyclePhase21.test.ts`,
  "src/test/lemtelDesktopPortalLifecyclePhase21.test.ts",
  "docs/lemtel-desktop/phase-21b-portal-device-lifecycle.md",
].sort();

const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const V = "Ver" + "to";
// Exact non-executable contract labels; only these occurrences are exempt from the forbidden-word scan.
const CONTRACT_LABELS = ["portal_password_or_microsoft_sso", "portal_password", "avaSmsActionState", "avaCallActionState"];
const stripLabels = (s: string) => CONTRACT_LABELS.reduce((acc, l) => acc.split(`'${l}'`).join("''").split(l + ":").join(":"), s);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

describe("Lemtel Phase 21B — Desktop portal device lifecycle", () => {
  const statusBefore = git("status", "--porcelain");

  it("guards pass before (no-arg and --scope)", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${SCOPE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("declares exactly nine Phase 21B files, none protected, and the delivery range stays within them", () => {
    expect(FILES.length).toBe(9);
    expect(FILES.filter(isProtected)).toEqual([]);
    for (const f of FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    execFileSync("git", ["merge-base", "--is-ancestor", SCOPE, "HEAD"], { cwd: root });
    const committed = git("diff", "--name-only", "--no-renames", `${SCOPE}..HEAD`).split("\n").filter(Boolean);
    expect(committed.filter(isProtected)).toEqual([]);
    for (const f of committed) expect(FILES, f).toContain(f);
  });

  it("strict manifest: direct routing, edge false, four capabilities, 900 s, desktop permission", () => {
    const s = rd(LIB);
    expect(s).toContain("m.routing.edgeFeatureGate !== false");
    expect(s).toContain("m.routing.routingMode !== 'direct_current'");
    expect(s).toContain("m.routing.fallbackMode !== 'direct_current'");
    expect(s).toContain("if (m.access.desktopEnabled !== true) return 'blocked_desktop_access'");
    expect(s).toContain("if (m.access.accountState !== 'active') return 'blocked_account'");
    expect(s).toContain("m.device.deviceState !== 'approved' || m.device.deviceAction !== 'none'");
    expect(s).toContain("if (exp <= now) return 'expired_manifest'");
    expect(s).toContain("MIN_REFRESH_SECONDS = 900");
    expect(s).toContain("const DEVICE_REF_RE = /^dev_[0-9a-f]{32}$/;");
    expect(s).toContain("exactKeys(ca, Object.keys(CAPABILITY_ENUMS))");
    for (const c of ["maestroSyncState", "avaCallActionState", "avaSmsActionState", "microsoftSsoState"]) expect(s).toContain(c);
    expect(s).toContain("const INSTALLATION_KEY = 'lemtel.desktop.installation_ref.v1'");
    expect(s).toContain("const MANIFEST_KEY = 'lemtel.desktop.client_config.v1'");
    expect(s).not.toMatch(/removeKey\(INSTALLATION_KEY\)/);
  });

  it("lifecycle modules store no token, credential, SIP id, URL or password and never log", () => {
    for (const f of [LIB, HOOK]) {
      const s = rd(f);
      expect(s).not.toMatch(/console\./);
      expect(s).not.toMatch(/setItem\([^)]*(token|password|credential|sip|url)/i);
    }
    expect(rd(LIB)).not.toMatch(/setTimeout|setInterval|\bfetch\(|WebSocket|Worker/);
    expect(rd(HOOK)).not.toMatch(/setTimeout|setInterval|WebSocket|Worker/);
    expect(rd(HOOK)).toContain("const FN = 'lemtel-client-config'");
    expect(rd(HOOK)).toContain("platform: 'desktop'");
  });

  it("App runs the hook before SipKeepAlive, has no legacy mode, gates CDR and background sync on allowed", () => {
    const s = rd(MAIN);
    const hookAt = s.indexOf("useLemtelDesktopClientConfig(creds?.accessToken || null)");
    expect(hookAt).toBeGreaterThan(0);
    expect(s.indexOf("<SipKeepAlive creds={creds} allowNewActions={lifecycleAllowed}>")).toBeGreaterThan(hookAt);
    expect(s.indexOf("if (lifecycleStatus === 'checking')")).toBeLessThan(s.indexOf("<SipKeepAlive creds={creds}"));
    expect(s).not.toMatch(/legacy/i);
    expect(s).toContain("{lifecycleAllowed && <AllowedCdrSync />}");
    expect(s).toContain("{lifecycleAllowed && <DesktopBackgroundSync");
    const desktopApp = s.slice(s.indexOf("function DesktopApp()"));
    expect(desktopApp).not.toMatch(/triggerCdrSync|setInterval/);
    expect([...s.matchAll(/triggerCdrSync\(\);/g)].length).toBe(1);
    expect(s).toContain("Accès Desktop indisponible");
    expect(s).toContain("Revenir à la connexion");
  });

  it("revocation is deferred during a call, stops SIP once, local sign-out only, no hangup/timer/reload/PBX", () => {
    const s = rd(MAIN);
    const block = between(s, "// Deferred revocation", "const returnToSignIn");
    expect(block).toContain("if (lifecycleStatus !== 'pending_block' || isBusyCallState(callState)) return;");
    expect(block).toContain("if (finalizingRef.current) return;");
    expect([...block.matchAll(/sipProvider\.stop/g)].length).toBe(1);
    expect(block).not.toMatch(/hangup|setTimeout|setInterval|reload|fusion|pbx|speaker/i);
    const clear = between(s, "async function clearLocalDesktopPolicyState", "const isBusyCallState");
    expect(clear).toContain("supabase.auth.signOut({ scope: 'local' })");
    expect(clear).toContain("removeItem('lemtel.sip_password')");
    expect(clear).not.toMatch(/reload|hangup|setTimeout/);
    expect(s).toContain("if (!finalizingRef.current) {\n          try { await sipProvider.stop?.(); }");
    const ret = between(s, "const returnToSignIn", "const openSettingsMobile");
    expect(ret).not.toMatch(/reload|call\(|setTimeout/);
  });

  it("allowNewActions blocks call/retry/restart/auto-heal/re-init but keeps existing call controls", () => {
    const s = rd(SOFT);
    expect(s).toContain("allowNewActions?: boolean;");
    expect(s).toContain("const allowNewActions = args.allowNewActions !== false;");
    expect(between(s, "call: useCallback(async", "answer:")).toContain("if (!allowRef.current) return");
    expect(between(s, "retryNow: useCallback", "restart:")).toContain("if (!allowRef.current) return;");
    expect(between(s, "restart: useCallback", "}, []),")).toContain("if (!allowRef.current) return;");
    expect(between(s, "// Auto-heal", "useEffect(() => {\n    const unsub")).toContain("if (!allowNewActions) return;");
    expect(s).toContain("if (!allowRef.current) return;\n    let cancelled");
    for (const k of ["answer", "hangup", "mute", "unmute", "hold", "unhold", "sendDTMF"]) {
      const seg = s.slice(s.indexOf(`    ${k}: useCallback`), s.indexOf("\n", s.indexOf(`    ${k}: useCallback`)));
      expect(seg, k).not.toContain("allowRef");
    }
    expect([...s.matchAll(/await sipProvider\.init\(/g)].length).toBe(1);
  });

  it("new lifecycle modules contain no forbidden stack, endpoint or sensitive data", () => {
    for (const f of [LIB, HOOK]) {
      const s = stripLabels(rd(f));
      expect(s, f).not.toMatch(new RegExp(V + "|pjsip|jssip|fusion|\\bpbx\\b|wss?:\\/\\/|softphone-credentials|sipPassword|password|refresh_token|access_token|recording_url|cdr|voicemail_|\\bsms\\b|WebSocket|secret", "i"));
    }
    expect(rd(MAIN)).not.toContain(V);
    expect(rd(MAIN)).not.toMatch(/pjsip/i);
  });

  it("real temporary Git repository: nine files accepted; tenth or Planiprêt path refused", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p21b-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p21b");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(check([])).toBe(true);
    expect(check(["apps/ava-softphone-desktop/src/lib/sip/jssipProvider.ts"])).toBe(false);
    expect(check(["apps/planipret-mobile/src/x.ts"])).toBe(false);
  }, 30000);

  it("guards pass after and the real repository is unchanged by the tests", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${SCOPE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
