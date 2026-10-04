import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 27A — Mobile recordings are own_extension_only. Read-only Git; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "179f313c6";
const M = "apps/ava-softphone-mobile/src";
const API = `${M}/lib/mobileApi.ts`;
const CALLS = `${M}/screens/CallsScreen.tsx`;
const REC = `${M}/screens/RecordingsScreen.tsx`;
const FILES = [
  API, CALLS, REC,
  `${M}/screens/RecordingsScreen.privacy.test.tsx`,
  "src/test/lemtelMobileRecordingsPrivacyPhase27.test.ts",
  "docs/lemtel-mobile/phase-27a-mobile-recordings-privacy.md",
  "docs/lemtel-mobile/phase-27a-threat-model.md",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const changed = () => {
  const committed = git("diff", "--name-only", "--no-renames", BASE).split("\n");
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n");
  return [...new Set([...committed, ...untracked].filter(Boolean))].sort();
};
const added = (f: string) => git("diff", "--no-renames", "-U0", BASE, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 27A — Mobile recordings privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("BASE is a commit ancestor; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, "HEAD"], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the seven allowed paths changed, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("mobileApi.recordings takes no extension and never builds extension=", () => {
    const s = rd(API);
    expect(s).toContain("recordings: (opts?: { rangeDays?: 7 | 30 }) => call<RecordingEntry[] | any>(");
    expect(s).toContain("`/mobile-recordings?days=${opts?.rangeDays === 30 ? 30 : 7}`,");
    const block = s.slice(s.indexOf("recordings: (opts?"), s.indexOf("Invalid response from mobile-recordings"));
    expect(block).not.toContain("extension");
  });

  it("RecordingsScreen is personal-only with an extension-scoped realtime channel", () => {
    const s = rd(REC);
    for (const bad of ["isAdmin", "extFilter", "domainExtensions", "pbx_extensions_directory", "Toutes les extensions", "All extensions", "organization_id=eq", "fallbackDomainUuid", "restGet"]) expect(s.includes(bad), bad).toBe(false);
    expect(s).toContain("if (!myExtension) return () => { cancelled = true; };");
    expect(s).toContain("if (!myExtension) { setItems([]); return; }");
    expect(s).toContain("mobileApi.recordings({ rangeDays })");
    expect(s).toContain("const filter = `extension=eq.${myExtension}`;");
    expect(s).toContain("supabase.channel(`recordings-ext-${myExtension}`)");
    expect(s).toContain("ch && supabase.removeChannel(ch)");
    expect(s).toContain("window.removeEventListener('focus', onFocus);");
    expect(s).toContain("window.removeEventListener('ava:callEnded', onCallEnded as any);");
  });

  it("CallsScreen no longer passes isAdmin to RecordingsScreen", () => {
    const s = rd(CALLS);
    const line = s.split("\n").find((l) => l.includes("<RecordingsScreen "))!;
    expect(line).not.toContain("isAdmin");
    expect(line).toContain("myExtension={myExt}");
  });

  it("added product lines contain no Verto, PJSIP, SIP URL, credential, PBX write or server action", () => {
    for (const f of [API, CALLS, REC]) {
      // Pre-existing credential-free field name kept on rewritten lines.
      const a = added(f).replace(/fusionpbxDomainUuid/g, "");
      for (const tok of ["ver" + "to", "Ver" + "to", "pjsip", "PJSIP", "sip:", "wss://", "https://", "sec" + "ret", "token", "fusionpbx", "FusionPBX", "fetch(", "POST", "migration", "functions/v1", ".insert(", ".update(", ".upsert(", ".delete("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
