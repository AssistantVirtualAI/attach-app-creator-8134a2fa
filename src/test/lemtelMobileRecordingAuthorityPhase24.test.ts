import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 24A — Mobile manual recording obeys the validated portal recordingPolicy.
// Read-only Git commands only; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "51831e134";
const M = "apps/ava-softphone-mobile/src";
const APP = `${M}/MobileApp.tsx`;
const SHEET = `${M}/components/ActiveCallSheet.tsx`;
const MTEST = `${M}/components/ActiveCallSheet.recordingPolicy.test.tsx`;
const DOC = "docs/lemtel-mobile/phase-24a-mobile-recording-authority.md";
const SELF = "src/test/lemtelMobileRecordingAuthorityPhase24.test.ts";
const FILES = [APP, SHEET, MTEST, DOC, SELF].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
// Committed range plus pending changes, so the check holds before and after the automatic commit.
const changed = () => {
  const committed = git("diff", "--name-only", "--no-renames", `${BASE}..HEAD`).split("\n");
  const pending = git("status", "--porcelain", "--untracked-files=all").split("\n").map((l) => l.slice(3));
  return [...new Set([...committed, ...pending].filter(Boolean))].sort();
};
const added = (f: string) => git("diff", "--no-renames", "-U0", BASE, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 24A — Mobile manual recording authority", () => {
  const statusBefore = git("status", "--porcelain");

  it("BASE is a commit and strict ancestor of HEAD; guards pass before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, "HEAD"], { cwd: root });
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", "HEAD").trim());
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${BASE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the five allowed paths changed, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("MobileApp passes a restrictive default policy to ActiveCallSheet", () => {
    const s = rd(APP);
    expect(s).toContain("<ActiveCallSheet sp={sp} haptic={haptic} recordingPolicy={recordingPolicy} />");
    expect(s).toMatch(/rawRecordingPolicy === 'user_allowed' \|\| rawRecordingPolicy === 'portal_managed' \? rawRecordingPolicy : 'not_allowed'/);
    expect(s).toContain("portalTelephonyPolicy?.recordingPolicy");
  });

  it("ActiveCallSheet exposes start/stop only under recordingPolicy === 'user_allowed'", () => {
    const s = rd(SHEET);
    expect(s).toContain("recordingPolicy = 'not_allowed'");
    expect(s).toContain("const manualRecordAllowed = recordingPolicy === 'user_allowed';");
    expect(s).toContain("if (!manualRecordAllowed) return;");
    expect(s).toMatch(/\{manualRecordAllowed \? \([\s\S]*?'Stop Rec' : 'Record'[\s\S]*?\) : \(/);
    expect(s.match(/sp\.startRecord/g)?.length).toBe(1);
    expect(s.match(/sp\.stopRecord/g)?.length).toBe(1);
  });

  it("restrictive policies render a passive note and no manual command route", () => {
    const s = rd(SHEET);
    const note = s.slice(s.indexOf('data-testid="recording-policy-note"'), s.indexOf("</div>", s.indexOf('data-testid="recording-policy-note"')));
    expect(note).toContain("Recording managed in portal");
    expect(note).toContain("Manual recording is not allowed");
    for (const bad of ["onClick", "onPress", "<a", "<button", "record(", "invoke", "href"]) expect(note, bad).not.toContain(bad);
  });

  it("no new signaling, PBX/FusionPBX, network, credential, Verto or native code added", () => {
    const V = "Ver" + "to";
    for (const f of [APP, SHEET, MTEST]) {
      const a = added(f);
      for (const tok of [V, "PJSIP", "Pjsip", "fetch(", "functions.invoke", "functions/v1", "new WebSocket", "wss://", "sip:", "REGISTER", "INVITE", "fusionpbx", "password", "secret", "Capacitor.registerPlugin", "registerPlugin("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guards pass after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${BASE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
