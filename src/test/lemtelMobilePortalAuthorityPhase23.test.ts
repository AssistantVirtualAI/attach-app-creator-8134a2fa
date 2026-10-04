import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Phase 23A — Mobile: the Lemtel portal is the only DND/forwarding authority.
// Stable regression test: static reads + temporary Git repo; no BASE..HEAD, no network.
const root = path.resolve(__dirname, "../..");
const M = "apps/ava-softphone-mobile/src";
const SET = `${M}/screens/SettingsScreen.tsx`;
const API = `${M}/lib/mobileApi.ts`;
const POLICY = "schemas/lemtel-isolation/planipret-protected-paths-v1.json";
const FILES = [
  SET,
  API,
  `${M}/test/settingsSheets.test.tsx`,
  "docs/lemtel-mobile/phase-23a-mobile-portal-authority.md",
  "src/test/lemtelMobilePortalAuthorityPhase23.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

describe("Lemtel Phase 23A — Mobile portal authority for DND/forwarding", () => {
  const statusBefore = git("status", "--porcelain");

  it("global guard passes before; permanent policy file unchanged in working tree", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain", "--", POLICY)).toBe("");
  });

  it("SettingsScreen has no local DND/forwarding control, sheet or write path", () => {
    const s = rd(SET);
    for (const bad of ["toggleDnd", "openFwdSheet", "commitFwd", "fwdInput", "mobileApi.setDnd", "mobileApi.setForwarding", "/mobile-settings-dnd", "/mobile-settings-forwarding", "sheet === 'fwd'", "'fwd' |", "setForwarding(", "setDnd(", "settings.callForwarding", "t('settings.dnd')"]) {
      expect(s, bad).not.toContain(bad);
    }
    expect(s).toContain("mobileApi.me()");
  });

  it("mobileApi no longer exposes DND/forwarding writes", () => {
    const a = rd(API);
    for (const bad of ["setDnd", "setForwarding", "/mobile-settings-dnd", "/mobile-settings-forwarding"]) expect(a, bad).not.toContain(bad);
  });

  it("PortalPolicyCard is present and strictly non-interactive", () => {
    const s = rd(SET);
    expect(s).toContain("function PortalPolicyCard");
    expect(s).toContain("<PortalPolicyCard policy={portalTelephonyPolicy}");
    const card = between(s, "function PortalPolicyCard", "\n}\n");
    for (const bad of ["<button", "<input", "<select", "onClick", "onPress", "mobileApi", "token", "wss"]) expect(card, bad).not.toContain(bad);
  });

  it("out-of-scope rows and preferences remain", () => {
    const s = rd(SET);
    expect(s).toContain("t('settings.ringtone')");
    expect(s).toContain("t('settings.audioOutput')");
    expect(s).toContain("Click-to-Call");
    expect(s).toContain("bgCalls");
  });

  it("real temporary Git repository: five files pass, sixth or Planiprêt path fails; real repo unchanged", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p23a-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p23a");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(FILES.length).toBe(5);
    expect(check([])).toBe(true);
    expect(check(["apps/ava-softphone-mobile/src/MobileApp.tsx"])).toBe(false);
    expect(check(["apps/planipret-mobile/src/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 30000);

  it("global guard passes after; status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
