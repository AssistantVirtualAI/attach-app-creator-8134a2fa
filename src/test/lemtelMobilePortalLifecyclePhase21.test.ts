import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const APP = "apps/ava-softphone-mobile/src";
const LIB = `${APP}/lib/lemtelClientConfig.ts`;
const HOOK = `${APP}/hooks/useLemtelMobileClientConfig.ts`;
const MAIN = `${APP}/MobileApp.tsx`;
const FILES = [
  LIB,
  `${APP}/lib/lemtelClientConfig.test.ts`,
  HOOK,
  `${APP}/hooks/useLemtelMobileClientConfig.test.tsx`,
  MAIN,
  "docs/lemtel-mobile/phase-21a-portal-device-lifecycle.md",
  "docs/lemtel-mobile/phase-21a-threat-model.md",
  "src/test/lemtelMobilePortalLifecyclePhase21.test.ts",
].sort();

const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const V = "Ver" + "to";
// 21A.1: exact non-executable Phase 16 contract labels; only these occurrences are exempt from the forbidden-word scan.
const CONTRACT_LABELS = ["portal_password_or_microsoft_sso", "portal_password", "avaSmsActionState"];
const stripLabels = (s: string) => CONTRACT_LABELS.reduce((acc, l) => acc.split(`'${l}'`).join("''").split(l + ":").join(":"), s);

describe("Lemtel Phase 21A — mobile portal device lifecycle", () => {
  it("Planiprêt guard passes before", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));

  it("declares exactly eight Phase 21A files, none protected", () => {
    expect(FILES.length).toBe(8);
    expect(FILES.filter(isProtected)).toEqual([]);
    for (const f of FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });

  it("module requires a safe manifest, direct routing and edge false; blocks unauthorized states", () => {
    const s = rd(LIB);
    expect(s).toContain("m.routing.edgeFeatureGate !== false");
    expect(s).toContain("m.routing.routingMode !== 'direct_current'");
    expect(s).toContain("m.routing.fallbackMode !== 'direct_current'");
    expect(s).toContain("if (m.access.mobileEnabled !== true) return 'blocked_mobile_access'");
    expect(s).toContain("if (m.access.accountState !== 'active') return 'blocked_account'");
    expect(s).toContain("m.device.deviceState !== 'approved' || m.device.deviceAction !== 'none'");
    expect(s).toContain("if (exp <= now) return 'expired_manifest'");
    expect(s).toContain("MIN_REFRESH_SECONDS = 900");
  });

  it("installation ref is stable, never logged and never removed on block", () => {
    const s = rd(LIB);
    expect(s).toContain("const INSTALLATION_KEY = 'lemtel.mobile.installation_ref.v1'");
    expect(s).not.toMatch(/removeKey\(INSTALLATION_KEY\)/);
    expect(s).toContain("await removeKey(MANIFEST_KEY);");
    for (const f of [LIB, HOOK]) expect(rd(f)).not.toMatch(/console\./);
    expect(rd(MAIN)).not.toMatch(/console\.[a-z]+\([^)]*installationRef/);
  });

  it("MobileApp runs the lifecycle before hydration and gates hydration and sipConfig on sipAllowed", () => {
    const s = rd(MAIN);
    const hookAt = s.indexOf("useLemtelMobileClientConfig(creds?.accessToken || null)");
    expect(hookAt).toBeGreaterThan(0);
    const hydrations = [...s.matchAll(/hydrateSoftphoneCredentials\('mobile'\)/g)].map((m) => m.index!);
    expect(hydrations.length).toBe(3);
    for (const i of hydrations) expect(i).toBeGreaterThan(hookAt);
    expect(s).toContain("if (!creds?.accessToken || !sipAllowed) return;");
    expect(s).toContain("if (!sipAllowed || !creds.accessToken || !creds.extension || !softphone.sipError) return;");
    expect(s).toContain("if (sipAllowed && creds.accessToken && hydratedTokenRef.current !== creds.accessToken)");
    expect(s).toContain("const sipConfig = sipAllowed && credentialsReady");
    expect(s.indexOf("const sipConfig = sipAllowed")).toBeLessThan(s.indexOf("useSoftphone(sipConfig)"));
  });

  it("MobileApp uses local sign-out, defers block until idle, never auto-hangs-up or calls PBX", () => {
    const s = rd(MAIN);
    expect(s).toContain("supabase.auth.signOut({ scope: 'local' })");
    expect(s).toContain("clientConfig.status !== 'pending_block' || inCallNow");
    expect(s).toContain("Accès Mobile indisponible");
    expect(s).toContain("Revenir à la connexion");
    const block = s.slice(s.indexOf("const finalizingRef"), s.indexOf("const inCall =\n"));
    expect(block).not.toMatch(/hangup|setSpeaker|speaker|reload|setTimeout|setInterval|fusion|pbx/i);
    expect(block).toContain("Capacitor.getPlatform() === 'ios'");
    expect(s).not.toContain(V);
  });

  it("Android paths still name JsSIP as sole WSS/REGISTER owner and the helper carries no credentials", () => {
    expect(rd(MAIN)).toContain("JsSIP is the only WebSocket and registration owner");
    const np = rd(`${APP}/lib/sip/nativeSipProvider.ts`);
    const helper = np.slice(np.indexOf("export async function startAndroidSipService"), np.indexOf("export async function stopAndroidSipService"));
    expect(helper).not.toMatch(/password|account/i);
  });

  it("new lifecycle code contains no forbidden stack, endpoint or sensitive data access", () => {
    for (const f of [LIB, HOOK]) {
      const s = stripLabels(rd(f));
      expect(s).not.toMatch(new RegExp(V + "|pjsip|jssip|fusion|wss?:\\/\\/|softphone-credentials|sipPassword|password|refresh_token|access_token|recording_url|cdr|voicemail_|sms", "i"));
      expect(s).not.toMatch(/\bfetch\(|WebSocket|setInterval/);
    }
    expect(rd(HOOK)).toContain("const FN = 'lemtel-client-config'");
  });

  it("real temporary Git repository: eight files accepted; ninth or Planiprêt path refused; real repo unchanged", () => {
    const before = git("status", "--porcelain");
    const scope = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p21a-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p21a");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(scope([])).toBe(true);
    expect(scope(["apps/ava-softphone-mobile/src/hooks/useSoftphone.ts"])).toBe(false);
    expect(scope(["apps/planipret-mobile/src/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(before);
  }, 30000);

  it("21A.1: frozen range d0c306208..314fc946f is exactly the eight original files (never compared to HEAD)", () => {
    execFileSync("git", ["merge-base", "--is-ancestor", "d0c306208", "314fc946f"], { cwd: root });
    const list = git("diff", "--name-only", "--no-renames", "d0c306208", "314fc946f").split("\n").filter(Boolean).sort();
    expect(list).toEqual(FILES);
  });

  it("21A.1: strict validator rules are present", () => {
    const s = rd(LIB);
    expect(s).toContain("const OPAQUE_REF_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;");
    expect(s).toMatch(/UTC_Z_RE = .*\(\?:\\\.\\d\{1,3\}\)\?Z\$/);
    for (const e of ["maestroSyncState", "avaCallActionState", "avaSmsActionState", "microsoftSsoState", "requires_user_confirmation", "portal_password_or_microsoft_sso", "foreground_and_revision_check", "portal_managed", "error_only"]) expect(s).toContain(e);
    expect(s).toContain("exactKeys(ca, Object.keys(CAPABILITY_ENUMS))");
    expect(s).toContain("exactKeys(ob, ['diagnosticLevel', 'redactionPolicyRef', 'supportBundleAllowed'])");
    expect(s).not.toMatch(/const str = /);
    expect(stripLabels(s)).not.toMatch(new RegExp(V + "|pjsip|jssip|fusion|\\bpbx\\b|wss?:\\/\\/|sipPassword|password|refresh_token|access_token|recording_url|cdr|voicemail_|sms|\\bfetch\\(|WebSocket", "i"));
  });

  it("Planiprêt guard passes after", () => expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n"));
});
