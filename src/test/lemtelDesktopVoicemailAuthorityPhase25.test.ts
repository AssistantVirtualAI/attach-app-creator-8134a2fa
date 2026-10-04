import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 25B — Desktop voicemail greeting is managed only by the Lemtel portal.
// Read-only Git commands only; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "d7716ea1f";
const PHASE25B_END = "4058dbaa9";
const D = "apps/ava-softphone-desktop/src";
const CARD = `${D}/components/VoicemailGreetingCard.tsx`;
const CTEST = `${D}/components/VoicemailGreetingCard.portalAuthority.test.tsx`;
const VIEW = `${D}/components/console/VoicemailView.tsx`;
const SELF = "src/test/lemtelDesktopVoicemailAuthorityPhase25.test.ts";
const FILES = [CARD, CTEST, "docs/lemtel-desktop/phase-25b-desktop-voicemail-authority.md", SELF].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
// Frozen historical range only (Phase 25B.1); later commits cannot move it.
const changed = () => git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE25B_END}`).split("\n").filter(Boolean).sort();
const added = (f: string) => git("diff", "--no-renames", "-U0", `${BASE}..${PHASE25B_END}`, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 25B — Desktop voicemail greeting authority", () => {
  const statusBefore = git("status", "--porcelain");

  it("frozen bounds are distinct ordered commits; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE25B_END).trim()).toBe("commit");
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE25B_END).trim());
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE25B_END], { cwd: root });
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE25B_END, "HEAD"], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("commits after PHASE25B_END do not move the frozen range", () => {
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE25B_END, "HEAD"], { cwd: root });
    expect(changed()).toEqual(FILES);
  });

  it("exactly the four allowed paths changed, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("card has no local configuration, generation, preview, request, state or control", () => {
    const s = rd(CARD);
    expect(s).toContain("export default function VoicemailGreetingCard()");
    expect(s).toContain('data-testid="desktop-voicemail-greeting-portal-only"');
    expect(s).toContain('role="note"');
    for (const bad of ["supabase", "functions.invoke", "voicemail-greeting-tts", "user-voicemail-greeting", "generate", "saveToMailbox", "useState", "useEffect", "async", "await", "fetch(", "<button", "<input", "<textarea", "<select", "<audio", "<a ", "href", "onClick", "onChange", "onSubmit", "VOICES"]) {
      expect(s.includes(bad), bad).toBe(false);
    }
  });

  it("VoicemailView keeps the existing import and render", () => {
    const s = rd(VIEW);
    expect(s).toContain("import VoicemailGreetingCard from '../VoicemailGreetingCard';");
    expect(s).toContain("<VoicemailGreetingCard />");
  });

  it("no new signaling, PBX, URL, credential, endpoint, IPC or network in added lines", () => {
    const V = "Ver" + "to";
    for (const f of [CARD, CTEST]) {
      const a = added(f);
      for (const tok of [V, "PJSIP", "Pjsip", "JsSIP", "jssip", "fusionpbx", "FusionPBX", "sip:", "wss://", "https://", "functions/v1", "WebSocket", "password", "secret", "ipcRenderer", "electronAPI", "supabase"]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
