import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 25A — Mobile voicemail greeting configuration obeys the validated portal voicemailPolicy.
// Read-only Git commands only; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "681346146";
const PHASE25A_END = "35b35ca5f";
const M = "apps/ava-softphone-mobile/src";
const APP = `${M}/MobileApp.tsx`;
const MORE = `${M}/screens/MoreScreen.tsx`;
const CALLS = `${M}/screens/CallsScreen.tsx`;
const VM = `${M}/screens/VoicemailScreen.tsx`;
const VMTEST = `${M}/screens/VoicemailScreen.portalPolicy.test.tsx`;
const SELF = "src/test/lemtelMobileVoicemailAuthorityPhase25.test.ts";
const FILES = [
  APP, MORE, CALLS, VM, VMTEST, SELF,
  "docs/lemtel-mobile/phase-25a-mobile-voicemail-authority.md",
  "docs/lemtel-mobile/phase-25a-threat-model.md",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);

// Frozen historical range only (Phase 25A.1); later commits cannot move it.
const changed = () => git("diff", "--name-only", "--no-renames", `${BASE}..${PHASE25A_END}`).split("\n").filter(Boolean).sort();
const added = (f: string) => git("diff", "--no-renames", "-U0", `${BASE}..${PHASE25A_END}`, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 25A — Mobile voicemail greeting authority", () => {
  const statusBefore = git("status", "--porcelain");

  it("frozen bounds are distinct ordered commits; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE25A_END).trim()).toBe("commit");
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE25A_END).trim());
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE25A_END], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("commits after PHASE25A_END do not move the frozen range", () => {
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE25A_END, "HEAD"], { cwd: root });
    expect(changed()).toEqual(FILES);
  });

  it("exactly the eight allowed paths changed, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("MobileApp normalizes restrictively to disabled and propagates only the label", () => {
    const s = rd(APP);
    expect(s).toMatch(/const voicemailPolicy: 'enabled' \| 'disabled' =\s*portalTelephonyPolicy\?\.voicemailPolicy === 'enabled' \? 'enabled' : 'disabled';/);
    expect(s).toContain("<VoicemailScreen haptic={haptic} voicemailPolicy={voicemailPolicy} />");
    expect(s).toMatch(/<CallsScreen [^\n]*voicemailPolicy=\{voicemailPolicy\}/);
    expect(s).toMatch(/<MoreScreen [^\n]*voicemailPolicy=\{voicemailPolicy\}/);
  });

  it("MoreScreen and CallsScreen read no manifest and forward the prop", () => {
    for (const f of [MORE, CALLS]) {
      const s = rd(f);
      expect(s, f).not.toContain("useLemtelMobileClientConfig");
      expect(s, f).not.toContain("manifest");
      expect(s, f).toContain("voicemailPolicy: 'enabled' | 'disabled'");
      expect(s, f).toContain("<VoicemailScreen haptic={haptic} voicemailPolicy={voicemailPolicy} />");
    }
  });

  it("VoicemailScreen keeps list/playback/transcription and gates greeting configuration", () => {
    const s = rd(VM);
    expect(s).toContain("mobileApi.voicemails()");
    expect(s).toContain("mobileApi.analyzeCall");
    expect(s).toContain("mobileApi\n      .voicemailAudio");
    expect(s).toContain("voicemailPolicy = 'disabled'");
    expect(s).toContain("const greetingAllowed = voicemailPolicy === 'enabled';");
    const eff = s.slice(s.indexOf("action: 'get_settings'") - 400, s.indexOf("action: 'get_settings'"));
    expect(eff).toContain("if (!greetingAllowed) return;");
    const save = s.slice(s.indexOf("const saveGreeting = async () => {"));
    expect(save.split("\n")[1].trim()).toBe("if (voicemailPolicy !== 'enabled') return;");
    expect(save.indexOf("if (voicemailPolicy !== 'enabled') return;")).toBeLessThan(save.indexOf("edgeCall"));
    expect(s).toContain('data-testid="voicemail-greeting-disabled"');
    expect(s).toContain("const GreetingEditor = !greetingAllowed ? GreetingDisabled : (");
  });

  it("no new Verto, PJSIP, FusionPBX, SIP/WSS URL, secret or hardcoded endpoint", () => {
    const V = "Ver" + "to";
    for (const f of [APP, MORE, CALLS, VM, VMTEST]) {
      const a = added(f);
      for (const tok of [V, "PJSIP", "Pjsip", "fusionpbx", "FusionPBX", "sip:", "wss://", "https://", "functions/v1", "new WebSocket", "password", "secret", "registerPlugin("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
