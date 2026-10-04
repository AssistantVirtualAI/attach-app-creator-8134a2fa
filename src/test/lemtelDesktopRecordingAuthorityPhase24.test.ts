import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 24B — Desktop manual recording obeys the validated portal recordingPolicy.
// Read-only Git commands only; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "06c5a0197";
const PHASE24B_END = "5468139d2";
const D = "apps/ava-softphone-desktop/src";
const APP = `${D}/App.tsx`;
const HOOK = `${D}/hooks/useSoftphone.ts`;
const PANE = `${D}/components/SoftphonePane.tsx`;
const FILES = [
  APP, HOOK, PANE,
  `${D}/hooks/useSoftphone.recordingPolicy.test.tsx`,
  `${D}/components/SoftphonePane.recordingPolicy.test.tsx`,
  "docs/lemtel-desktop/phase-24b-desktop-recording-authority.md",
  "src/test/lemtelDesktopRecordingAuthorityPhase24.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
// Frozen historical range only (Phase 24A.1); later Lemtel phases cannot affect it.
const changed = () => git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE24B_END}`).split("\n").filter(Boolean).sort();
const added = (f: string) => git("diff", "--no-renames", "-U0", `${BASE}..${PHASE24B_END}`, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
// Read-only view of everything after the frozen end (committed + pending), for the positive proof.
const laterPaths = () => {
  const committed = git("diff", "--name-only", "--no-renames", `${PHASE24B_END}..HEAD`).split("\n");
  const pending = git("status", "--porcelain", "--untracked-files=all").split("\n").map((l) => l.slice(3));
  return [...new Set([...committed, ...pending].filter(Boolean))].sort();
};

describe("Lemtel Phase 24B — Desktop manual recording authority", () => {
  const statusBefore = git("status", "--porcelain");

  it("frozen bounds are distinct ordered commits; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE24B_END).trim()).toBe("commit");
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE24B_END).trim());
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE24B_END], { cwd: root });
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE24B_END, "HEAD"], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("later non-Planipret change after PHASE24B_END stays outside the frozen range", () => {
    const later = "src/test/lemtelMobileRecordingAuthorityPhase24.test.ts";
    expect(isProtected(later)).toBe(false);
    expect(laterPaths()).toContain(later);
    expect(changed()).not.toContain(later);
    expect(changed()).toEqual(FILES);
  });

  it("exactly the seven allowed paths changed, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("App normalizes the policy strictly before passing it to SipKeepAlive", () => {
    const s = rd(APP);
    expect(s).toContain("const rawRecordingPolicy = portalTelephonyPolicy?.recordingPolicy;");
    expect(s).toMatch(/rawRecordingPolicy === 'user_allowed' \|\| rawRecordingPolicy === 'portal_managed' \? rawRecordingPolicy : 'not_allowed'/);
    expect(s).toContain("<RecordingPolicyContext.Provider value={recordingPolicy}>");
    expect(s).toContain("React.createContext<RecordingPolicy>('not_allowed')");
    expect(s).toContain("const recordingPolicy = React.useContext(RecordingPolicyContext);");
    expect(s).toMatch(/useSoftphone\(\{\s*allowNewActions,\s*recordingPolicy,/);
  });

  it("useSoftphone blocks toggleRecording before DTMF/fallback unless exactly user_allowed", () => {
    const s = rd(HOOK);
    expect(s).toContain("import type { RecordingPolicy } from '../lib/lemtelDesktopClientConfig';");
    expect(s).toContain("const manualRecordingAllowed = recordingPolicy === 'user_allowed';");
    const body = s.slice(s.indexOf("toggleRecording: useCallback(async () => {"));
    const first = body.split("\n")[1].trim();
    expect(first).toBe("if (!manualRecRef.current) return;");
    expect(body.indexOf("if (!manualRecRef.current) return;")).toBeLessThan(body.indexOf("sendDTMF('*2')"));
    expect(body.indexOf("if (!manualRecRef.current) return;")).toBeLessThan(body.indexOf("setRecording("));
  });

  it("SoftphonePane exposes the button only for user_allowed, two passive notes, passive indicator", () => {
    const s = rd(PANE);
    expect(s).toContain("const manualRecordingAllowed = sp.manualRecordingAllowed === true && sp.recordingPolicy === 'user_allowed';");
    expect(s).toMatch(/\{manualRecordingAllowed && \(\s*<ControlBtn[^\n]*onClick=\{sp\.toggleRecording\}/);
    expect(s.match(/sp\.toggleRecording/g)?.length).toBe(1);
    const note = s.slice(s.indexOf('data-testid="desktop-recording-policy-note"'), s.indexOf("</div>", s.indexOf('data-testid="desktop-recording-policy-note"')));
    expect(note).toContain("Recording managed in portal");
    expect(note).toContain("Manual recording is not allowed");
    expect(note).toContain('role="note"');
    for (const bad of ["onClick", "<a", "<button", "href", "toggleRecording"]) expect(note, bad).not.toContain(bad);
    const ind = s.slice(s.indexOf('data-testid="desktop-recording-indicator"'), s.indexOf("</div>", s.indexOf('data-testid="desktop-recording-indicator"')));
    expect(ind).not.toContain("onClick");
    expect(s).toMatch(/\{sp\.recording && \(\s*<div data-testid="desktop-recording-indicator"/);
  });

  it("added production lines contain no signaling, PBX, network, credential, Verto or native code", () => {
    const V = "Ver" + "to";
    for (const f of [APP, HOOK, PANE]) {
      const a = added(f);
      for (const tok of [V, "PJSIP", "Pjsip", "jssipProvider", "WebSocket", "REGISTER", "INVITE", "fetch(", "functions.invoke", "functions/v1", "wss://", "password", "secret", "fusionpbx", "registerPlugin", "ipcRenderer", "electronAPI"]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guards pass after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
