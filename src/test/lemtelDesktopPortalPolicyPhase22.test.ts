import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "63c6d5b72";
const PHASE22C_END = "ef64f5dea";
const D = "apps/ava-softphone-desktop/src";
const LIB = `${D}/lib/lemtelDesktopClientConfig.ts`;
const HOOK = `${D}/hooks/useLemtelDesktopClientConfig.ts`;
const APP = `${D}/App.tsx`;
const SET = `${D}/components/SettingsPage.tsx`;
const FILES = [
  LIB, `${D}/lib/lemtelDesktopClientConfig.test.ts`,
  HOOK, `${D}/hooks/useLemtelDesktopClientConfig.test.tsx`,
  APP, SET, `${D}/components/SettingsPage.portalPolicy.test.tsx`,
  "docs/lemtel-desktop/phase-22c-desktop-portal-policy.md",
  "docs/lemtel-desktop/phase-22c-threat-model.md",
  "src/test/lemtelDesktopPortalPolicyPhase22.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const changed = () =>
  git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE22C_END}`).split("\n").filter(Boolean).sort();
const V = "Ver" + "to";

describe("Lemtel Phase 22C — Desktop read-only portal policy", () => {
  const statusBefore = git("status", "--porcelain");

  it("frozen bounds are commits, BASE strict ancestor of PHASE22C_END; global guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE22C_END).trim()).toBe("commit");
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE22C_END).trim());
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE22C_END], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("later 22B.1 change is visible in BASE..HEAD but does not alter the frozen 22C range", () => {
    const live = git("diff", "--name-only", "--no-renames", `${BASE}..HEAD`).split("\n");
    expect(live).toContain("src/test/lemtelMobilePortalPolicyPhase22.test.ts");
    expect(changed()).toEqual(FILES);
  });

  it("exactly the ten allowed files changed, none protected, no Electron/Mobile/Supabase/package/SIP file", () => {
    expect(FILES.length).toBe(10);
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
    for (const f of c) expect(f).not.toMatch(/electron\/|ava-softphone-mobile|supabase\/|package(-lock)?\.json|bun\.lockb?|pnpm-lock|yarn\.lock|useSoftphone\.ts|lib\/sip\//);
  });

  it("strict unions and validation of the four states", () => {
    const s = rd(LIB);
    expect(s).toContain("export type RecordingPolicy = 'not_allowed' | 'user_allowed' | 'portal_managed';");
    expect(s).toContain("export type BinaryPortalPolicy = 'enabled' | 'disabled';");
    expect(s).toContain("dndState: BinaryPortalPolicy; forwardingState: BinaryPortalPolicy;");
    expect(s).toContain("recordingPolicy: RecordingPolicy; voicemailPolicy: BinaryPortalPolicy;");
    expect(s).toContain("!oneOf(tp.dndState, ON_OFF) || !oneOf(tp.forwardingState, ON_OFF) || !oneOf(tp.recordingPolicy, RECORDING_POLICIES) || !oneOf(tp.voicemailPolicy, ON_OFF)");
  });

  it("hook exposes only validated/cached manifest and nulls it on every non-allowed state", () => {
    const s = rd(HOOK);
    expect(s).toContain("manifest: LemtelManifest | null;");
    const apply = between(s, "const applyManifest", "}, []);");
    expect(apply.indexOf("decision === 'allowed'")).toBeLessThan(apply.indexOf("setManifest(m)"));
    expect(apply).toContain("setManifest(null)");
    const fail = between(s, "const handleFailure", "}, []);");
    expect(fail).toContain("setManifest(cached!.manifest)");
    expect(fail.match(/setManifest\(null\)/g)?.length).toBe(3);
    expect(between(s, "const finalizeBlock", "}, []);")).toContain("setManifest(null)");
    expect(between(s, "if (!hasSession) {", "return;")).toContain("setManifest(null)");
    expect(s).toContain("{ action: 'register', platform: 'desktop', installationRef: await getInstallationRef() }");
    expect(s.match(/fetch\(/g)?.length).toBe(1);
    for (const bad of ["setTimeout", "setInterval", "console."]) expect(s).not.toContain(bad);
  });

  it("App projects only telephonyPolicy to the main SettingsPage", () => {
    const a = rd(APP);
    expect(a).toContain("const portalTelephonyPolicy = lifecycle.manifest?.telephonyPolicy ?? null;");
    expect(a.match(/lifecycle\.manifest/g)?.length).toBe(1);
    expect(a.match(/portalTelephonyPolicy=\{portalTelephonyPolicy\}/g)?.length).toBe(1);
    expect(a).toContain("<SettingsPage creds={creds} onSignOut={signOutDesktop} onBack={() => setMobileSettings(false)} portalTelephonyPolicy={portalTelephonyPolicy} />");
  });

  it("card shows four labels and note, is strictly non-interactive, built from exported types", () => {
    const s = rd(SET);
    expect(s).toContain("import type { BinaryPortalPolicy, RecordingPolicy } from '../lib/lemtelDesktopClientConfig';");
    expect(s).toContain("portalTelephonyPolicy?: PortalTelephonyPolicy | null;");
    expect(s).toContain("{portalTelephonyPolicy && <PortalPolicyCard policy={portalTelephonyPolicy} />}");
    expect(s.indexOf("<PortalPolicyCard policy=")).toBeLessThan(s.indexOf('<SectionTitle eyebrow="CALLS" title="Call Settings" />'));
    const type = between(s, "export type PortalTelephonyPolicy", "};");
    expect(type).not.toContain("string");
    for (const l of ["Do not disturb: enabled", "Do not disturb: disabled", "Call forwarding: enabled", "Call forwarding: disabled", "Recording: not allowed", "Recording: user allowed", "Recording: portal managed", "Voicemail: enabled", "Voicemail: disabled",
      "Telephony settings are applied by the portal. Change them in the Lemtel portal.", 'data-testid="desktop-portal-policy"']) expect(s).toContain(l);
    const card = between(s, "function PortalPolicyCard", "\n}\n");
    for (const bad of ["onClick", "onPress", "openPortal", "sipProvider", "localStorage", "<button", "<input", "<select", "Switch", "electronAPI", "revision", "deviceRef", "wss"]) expect(card).not.toContain(bad);
  });

  it("no new endpoint, fetch, invoke, PBX/FusionPBX, SIP/WSS URL, Verto or PJSIP added", () => {
    for (const f of [LIB, HOOK, APP, SET]) {
      const before = git("show", `${BASE}:${f}`), now = rd(f);
      for (const tok of [V, "PJSIP", "Pjsip", "fetch(", "functions.invoke", "functions/v1", "fusionpbx", "wss://", "sip:", "sipProvider.", "openPortal(", "localStorage.setItem"]) {
        expect(now.split(tok).length, `${f} ${tok}`).toBe(before.split(tok).length);
      }
    }
  });

  it("real temporary Git repository: ten files pass, eleventh or Planiprêt path fails; real repo unchanged", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p22c-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p22c");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(check([])).toBe(true);
    expect(check(["apps/ava-softphone-desktop/electron/main.ts"])).toBe(false);
    expect(check(["apps/planipret-mobile/src/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 30000);

  it("guards pass after; status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
