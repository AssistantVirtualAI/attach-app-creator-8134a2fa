import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Phase 27A — Mobile recordings are own_extension_only. Read-only Git; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "179f313c6";
// Immutable Phase 27A end: historical scope is read only on BASE..PHASE27A_END.
const PHASE27A_END = "3128b873f";
const RANGE = `${BASE}..${PHASE27A_END}`;
const M = "apps/ava-softphone-mobile/src";
const API = `${M}/lib/mobileApi.ts`;
const CALLS = `${M}/screens/CallsScreen.tsx`;
const REC = `${M}/screens/RecordingsScreen.tsx`;
const FILES = [
  API, CALLS, REC,
  // Callers adapted to the one-argument recordings() signature (typecheck fix).
  `${M}/components/NotificationsSheet.tsx`, `${M}/components/StatsDashboard.tsx`,
  `${M}/screens/RecordingsScreen.privacy.test.tsx`,
  "src/test/lemtelMobileRecordingsPrivacyPhase27.test.ts",
  "docs/lemtel-mobile/phase-27a-mobile-recordings-privacy.md",
  "docs/lemtel-mobile/phase-27a-threat-model.md",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const gitIn = (cwd: string, a: string[], env?: NodeJS.ProcessEnv, input?: string) =>
  execFileSync("git", a, { cwd, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, input });
const phaseFiles = (cwd = root) => gitIn(cwd, ["diff", "--name-only", "--no-renames", RANGE]).trim().split("\n").filter(Boolean).sort();
const phaseAdded = (f: string, cwd = root) => gitIn(cwd, ["diff", "--no-renames", "-U0", RANGE, "--", f]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 27A — Mobile recordings privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("frozen bounds are commits, BASE strict ancestor; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE27A_END).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE27A_END], { cwd: root });
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE27A_END).trim());
    expect(RANGE.includes("HEAD")).toBe(false);
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the nine historical paths in the frozen range, none protected", () => {
    const c = phaseFiles();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("direct callers use the one-argument signature (7 and 30 days)", () => {
    expect(rd(`${M}/components/NotificationsSheet.tsx`)).toContain("mobileApi.recordings({ rangeDays: 7 })");
    expect(rd(`${M}/components/StatsDashboard.tsx`)).toContain("mobileApi.recordings({ rangeDays: 30 })");
  });

  it("a real later commit in a temporary clone does not change the frozen result", { timeout: 120000 }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemtel-phase27a1-"));
    try {
      execFileSync("git", ["clone", "-q", "--no-checkout", root, tmp], { encoding: "utf8" });
      const env = { GIT_INDEX_FILE: path.join(tmp, ".git", "phase27a1-index"), GIT_AUTHOR_NAME: "Phase 27A.1 validation", GIT_AUTHOR_EMAIL: "phase27a1@example.invalid", GIT_COMMITTER_NAME: "Phase 27A.1 validation", GIT_COMMITTER_EMAIL: "phase27a1@example.invalid" };
      const end = gitIn(tmp, ["rev-parse", PHASE27A_END]).trim();
      gitIn(tmp, ["update-ref", "HEAD", end]);
      const before = { files: phaseFiles(tmp), lines: [API, CALLS, REC].map((f) => phaseAdded(f, tmp)) };
      gitIn(tmp, ["read-tree", end], env);
      const blob = gitIn(tmp, ["hash-object", "-w", "--stdin"], env, "future non-protected fixture\n").trim();
      gitIn(tmp, ["update-index", "--add", "--cacheinfo", `100644,${blob},phase27a1_future_fixture.txt`], env);
      const tree = gitIn(tmp, ["write-tree"], env).trim();
      const commit = gitIn(tmp, ["commit-tree", tree, "-p", end, "-m", "Temporary future fixture"], env).trim();
      gitIn(tmp, ["update-ref", "HEAD", commit]);
      expect(gitIn(tmp, ["diff", "--name-only", `${end}..HEAD`]).trim()).toBe("phase27a1_future_fixture.txt");
      expect(phaseFiles(tmp)).toEqual(before.files);
      expect(phaseFiles(tmp)).toEqual(phaseFiles());
      expect([API, CALLS, REC].map((f) => phaseAdded(f, tmp))).toEqual(before.lines);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
      const a = phaseAdded(f).replace(/fusionpbxDomainUuid/g, "");
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
