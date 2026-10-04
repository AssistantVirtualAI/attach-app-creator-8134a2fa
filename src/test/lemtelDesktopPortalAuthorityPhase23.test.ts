import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Phase 23B — Desktop: the Lemtel portal is the only forwarding authority.
// Stable regression test: static reads + temporary Git repo; no BASE..HEAD, no network.
const root = path.resolve(__dirname, "../..");
const C = "apps/ava-softphone-desktop/src/components";
const FWD = `${C}/CallForwarding.tsx`;
const PANE = `${C}/SoftphonePane.tsx`;
const SET = `${C}/SettingsPage.tsx`;
const POLICY = "schemas/lemtel-isolation/planipret-protected-paths-v1.json";
const FILES = [
  FWD,
  PANE,
  "docs/lemtel-desktop/phase-23b-desktop-portal-authority.md",
  "src/test/lemtelDesktopPortalAuthorityPhase23.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const p = `${dir}/${e.name}`;
  return e.isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
});

describe("Lemtel Phase 23B — Desktop portal authority for forwarding", () => {
  const statusBefore = git("status", "--porcelain");

  it("global guard passes before; permanent policy file unchanged in working tree", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain", "--", POLICY)).toBe("");
  });

  it("CallForwarding.tsx no longer exists", () => {
    expect(fs.existsSync(path.join(root, FWD))).toBe(false);
  });

  it("SoftphonePane has no local forwarding component, field or direct softphone-user access", () => {
    const s = rd(PANE);
    for (const bad of ["CallForwarding", "./CallForwarding", "forward_enabled", "forward_to", "pbx_softphone_users"]) expect(s, bad).not.toContain(bad);
  });

  it("no Desktop component writes forwarding fields through pbx_softphone_users.update", () => {
    const re = /from\(\s*['"]pbx_softphone_users['"]\s*\)[\s\S]{0,400}?\.update\(/g;
    for (const f of walk(C)) {
      const s = rd(f);
      for (const m of s.matchAll(re)) {
        const win = s.slice(Math.max(0, m.index! - 800), m.index! + m[0].length + 400);
        expect(/forward_enabled|forward_to/.test(win), f).toBe(false);
      }
    }
  });

  it("SettingsPage untouched and keeps the read-only portal policy and the portal link", () => {
    expect(git("status", "--porcelain", "--", SET)).toBe("");
    const s = rd(SET);
    expect(s).toContain("desktop-portal-policy");
    for (const l of ["Do not disturb:", "Call forwarding:", "Recording:", "Voicemail:"]) expect(s, l).toContain(l);
    expect(s).toContain("Manage in portal");
  });

  it("out-of-scope Softphone elements remain", () => {
    const s = rd(PANE);
    for (const k of ["RecentsList", "ContactsList", "VoicemailList", "SmsThreads", "OutputDevicePicker", "SipRecoveryBanner"]) expect(s, k).toContain(k);
  });

  it("real temporary Git repository: four paths pass, fifth or Planiprêt path fails; real repo unchanged", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p23b-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        const put = (f: string, c: string) => { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), c); g("update-index", "--add", f); };
        put("README.md", "b\n"); put(FWD, "old\n"); put(PANE, "old\n");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        g("update-index", "--force-remove", FWD); fs.rmSync(path.join(tmp, FWD));
        for (const f of [PANE, ...FILES.filter((f) => f !== FWD && f !== PANE), ...extra]) put(f, "x\n");
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p23b");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(FILES.length).toBe(4);
    expect(check([])).toBe(true);
    expect(check(["apps/ava-softphone-desktop/src/App.tsx"])).toBe(false);
    expect(check(["apps/planipret-mobile/src/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 30000);

  it("global guard passes after; status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
