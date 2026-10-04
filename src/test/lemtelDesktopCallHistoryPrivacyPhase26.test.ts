import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Phase 26B — Desktop softphone Recents are own_extension_only. Historical scope frozen on BASE..PHASE26B_END;
// read-only Git; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "8f93abed1";
const D = "apps/ava-softphone-desktop/src";
const RECENTS = `${D}/components/RecentsList.tsx`;
const API = `${D}/lib/avaApi.ts`;
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
// Immutable Phase 26B end: historical scope is read only on BASE..PHASE26B_END.
const PHASE26B_END = "01844a2e2";
const RANGE = `${BASE}..${PHASE26B_END}`;
const FILES = [
  `${D}/components/RecentsList.privacy.test.tsx`, RECENTS, API,
  "docs/lemtel-desktop/phase-26b-desktop-call-history-privacy.md",
  "docs/lemtel-desktop/phase-26b-threat-model.md",
  "src/test/lemtelDesktopCallHistoryPrivacyPhase26.test.ts",
].sort();
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const gitIn = (cwd: string, a: string[], env?: NodeJS.ProcessEnv, input?: string) =>
  execFileSync("git", a, { cwd, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, input });
const phaseFiles = (cwd = root) => gitIn(cwd, ["diff", "--name-only", "--no-renames", RANGE]).trim().split("\n").filter(Boolean).sort();
const phaseAdded = (f: string, cwd = root) => gitIn(cwd, ["diff", "--no-renames", "-U0", RANGE, "--", f]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 26B — Desktop call history privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("permanent guard passes before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("frozen bounds are commits, BASE strict ancestor, exactly six historical paths", () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE26B_END).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE26B_END], { cwd: root });
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE26B_END).trim());
    const files = phaseFiles();
    expect(files).toEqual(FILES);
    expect(files.filter(isProtected)).toEqual([]);
    expect(RANGE.includes("HEAD")).toBe(false);
  });

  it("a real later commit in a temporary clone does not change the frozen result", { timeout: 120000 }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemtel-phase26b1-"));
    try {
      execFileSync("git", ["clone", "-q", "--no-checkout", root, tmp], { encoding: "utf8" });
      const idx = path.join(tmp, ".git", "phase26b1-index");
      const env = { GIT_INDEX_FILE: idx, GIT_AUTHOR_NAME: "Phase 26B.1 validation", GIT_AUTHOR_EMAIL: "phase26b1@example.invalid", GIT_COMMITTER_NAME: "Phase 26B.1 validation", GIT_COMMITTER_EMAIL: "phase26b1@example.invalid" };
      gitIn(tmp, ["read-tree", PHASE26B_END], env);
      const blob = gitIn(tmp, ["hash-object", "-w", "--stdin"], env, "future non-protected fixture\n").trim();
      gitIn(tmp, ["update-index", "--add", "--cacheinfo", `100644,${blob},phase26b1_future_fixture.txt`], env);
      const tree = gitIn(tmp, ["write-tree"], env).trim();
      const end = gitIn(tmp, ["rev-parse", PHASE26B_END]).trim();
      const commit = gitIn(tmp, ["commit-tree", tree, "-p", end, "-m", "Temporary future fixture"], env).trim();
      gitIn(tmp, ["update-ref", "HEAD", commit]);
      expect(gitIn(tmp, ["rev-parse", "HEAD~1"]).trim()).toBe(end);
      expect(gitIn(tmp, ["diff", "--name-only", `${end}..HEAD`]).trim()).toBe("phase26b1_future_fixture.txt");
      expect(phaseFiles(tmp)).toEqual(phaseFiles());
      expect(phaseFiles(tmp)).not.toContain("phase26b1_future_fixture.txt");
      for (const f of [RECENTS, API]) expect(phaseAdded(f, tmp)).toBe(phaseAdded(f));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("RecentsList uses only personal methods, no org/admin scope", () => {
    const s = rd(RECENTS);
    expect(s).toContain("ava.personalCalls(200, { rangeDays })");
    expect(s).toContain("ava.refreshPersonalCalls(200, { rangeDays })");
    for (const bad of ["ava.calls(", "ava.refreshCalls(", "useOrgId", "useRealtimeRefresh", "organization_id=eq", "scope:", "domain_uuid", "isAdmin"]) expect(s.includes(bad), bad).toBe(false);
  });

  it("defensive local filter and personal realtime channel with cleanup", () => {
    const s = rd(RECENTS);
    expect(s).toContain("export function isOwnRow(r: any, ext: string): boolean {");
    expect(s).toContain("[r.extension, r.caller_number, r.destination_number, r.source_number, r.from, r.to]");
    expect(s).toContain(".filter((r) => isOwnRow(r, extension))");
    expect(s).toContain("supabase.channel(`rt-pbx_call_records-extension-${extension}`)");
    expect(s).toContain("filter: `extension=eq.${extension}`");
    expect(s).toContain("if (isOwnRow(row, extension)) fire();");
    expect(s).toContain("supabase.removeChannel(channel)");
    expect(s).toContain("if (pending) clearTimeout(pending);");
    expect(s).toContain("if (!extension) return;");
  });

  it("avaApi exports personal methods resolved from getMeContext, admin methods kept", () => {
    const s = rd(API);
    expect(s).toContain("personalCalls: async (limit = 100, opts?: { rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("refreshPersonalCalls: async (limit = 150, opts?: { rangeDays?: 7 | 30 | null }) => {");
    // Scoped to the two Phase 26B call-history bodies only (Phase 27B.1).
    for (const sig of ["personalCalls: async (limit = 100,", "refreshPersonalCalls: async (limit = 150,"]) {
      const start = s.indexOf(`  ${sig}`);
      expect(start, sig).toBeGreaterThan(-1);
      const body = s.slice(start, s.indexOf("\n  },", start));
      expect(body).toContain("const me = await getMeContext();");
      expect(body).toContain("const ext = cleanText(me.extension);");
      expect(body).toContain("if (!ext) return [] as CallRecord[];");
      expect(body).toContain("readCallRecordRows(limit, { extension: ext, rangeDays: opts?.rangeDays ?? null })");
    }
    expect(s).toContain("calls: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("refreshCalls: async (limit = 150, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("scopedCallRecords: async (limit = 100,");
  });

  it("added active lines contain no Verto, PJSIP, SIP URL, PBX write, credential or data write", () => {
    for (const f of [RECENTS, API]) {
      const a = phaseAdded(f);
      for (const tok of ["ver" + "to", "Ver" + "to", "pjsip", "PJSIP", "sip:", "wss://", "https://", "fusionpbx", "FusionPBX", "invokeFusionSync", "functions/v1", "password", "sec" + "ret", ".insert(", ".update(", ".upsert(", ".delete(", "method: 'POST'", "import("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
