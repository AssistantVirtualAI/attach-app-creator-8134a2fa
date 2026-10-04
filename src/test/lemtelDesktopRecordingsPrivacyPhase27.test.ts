import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Phase 27B — Desktop softphone recordings are own_extension_only. Read-only Git; never writes the real repository.
// Phase 27B.1 — immutable historical range: scope is read only on BASE..PHASE27B_END.
const root = path.resolve(__dirname, "../..");
const BASE = "c84166455";
const PHASE27B_END = "b7c17287a";
const RANGE = `${BASE}..${PHASE27B_END}`;
const D = "apps/ava-softphone-desktop/src";
const API = `${D}/lib/avaApi.ts`;
const LIST = `${D}/components/RecordingsList.tsx`;
const PANE = `${D}/components/SoftphonePane.tsx`;
const PRODUCT = [API, LIST, PANE];
const FILES = [
  API, LIST, PANE,
  `${D}/components/RecordingsList.privacy.test.tsx`,
  "src/test/lemtelDesktopRecordingsPrivacyPhase27.test.ts",
  "docs/lemtel-desktop/phase-27b-desktop-recordings-privacy.md",
  "docs/lemtel-desktop/phase-27b-threat-model.md",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const gitIn = (cwd: string, a: string[], env?: NodeJS.ProcessEnv, input?: string) =>
  execFileSync("git", a, { cwd, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, input });
const phaseFiles = (cwd = root) => gitIn(cwd, ["diff", "--name-only", "--no-renames", RANGE]).split("\n").filter(Boolean).sort();
const phaseAdded = (f: string, cwd = root) =>
  gitIn(cwd, ["diff", "--no-renames", "-U0", RANGE, "--", f]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 27B — Desktop recordings privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("bounds are commits, BASE strict ancestor; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE27B_END).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE27B_END], { cwd: root });
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE27B_END).trim());
    expect(RANGE.includes("HEAD")).toBe(false);
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the seven allowed paths, none protected", () => {
    const c = phaseFiles();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("RecordingsList uses only personal methods, local row filter and extension Realtime", () => {
    const s = rd(LIST);
    for (const bad of ["ava.recordings", "ava.refreshRecordings", "useOrgId", "useRealtimeRefresh", "scope:", "isAdmin", "domain_uuid", "organization_id=eq"]) expect(s.includes(bad), bad).toBe(false);
    expect(s).toContain("await ava.refreshPersonalRecordings(200, { rangeDays })");
    expect(s).toContain("await ava.personalRecordings(200, { rangeDays })");
    expect(s).toContain("export function isOwnRecording(r: any, ext: string): boolean {");
    expect(s).toContain("[r.extension, r.caller_number, r.destination_number, r.source_number, r.from, r.to]");
    expect(s).toContain(".filter((r) => isOwnRecording(r, forExt))");
    expect(s).toContain("if (!isCurrent(sess)) return;");
    expect(s).toContain("supabase.channel(`rt-recordings-extension-${ext}`)");
    expect(s).toContain("filter: `extension=eq.${ext}`");
    expect(s).toContain("for (const ev of ['INSERT', 'UPDATE'] as const)");
    expect(s).toContain("isOwnRecording(payload?.new, ext) && isRecordingRealtimeChange(payload)");
    expect(s).toContain("if (pending) clearTimeout(pending);");
    expect(s).toContain("supabase.removeChannel(channel)");
    expect(s).toContain("audioCache.clear();");
    expect(s).toContain("return () => { genRef.current += 1; audioCache.clear(); };");
  });

  it("avaApi personal methods resolve the extension from getMeContext and refuse its absence", () => {
    const s = rd(API);
    for (const name of ["personalRecordings", "refreshPersonalRecordings"]) {
      const start = s.indexOf(`  ${name}: async (limit = 100, opts?: { rangeDays?: 7 | 30 | null }) => {`);
      expect(start, name).toBeGreaterThan(-1);
      const body = s.slice(start, s.indexOf("\n  },", start));
      expect(body).toContain("const me = await getMeContext();");
      expect(body).toContain("const ext = cleanText(me.extension);");
      expect(body).toContain("if (!ext) return [] as RecordingItem[];");
      expect(body).toContain("{ extension: ext, rangeDays: opts?.rangeDays ?? null }");
      expect(body).toContain(".map(mapCdrToRecording)");
      expect(body.indexOf("if (!ext) return")).toBeLessThan(body.indexOf("readCallRecordRows("));
    }
  });

  it("softphone passes exactly creds.extension, no scope props", () => {
    const line = rd(PANE).split("\n").find((l) => l.includes("<RecordingsList "))!;
    expect(line.trim()).toBe("<RecordingsList extension={creds.extension} />");
  });

  it("added product lines contain no Verto, PJSIP, SIP URL, credential, data write or server action", () => {
    for (const f of PRODUCT) {
      const a = phaseAdded(f);
      for (const tok of ["ver" + "to", "Ver" + "to", "pjsip", "PJSIP", "sip:", "wss://", "https://", "sec" + "ret", "token", "password", "fusionpbx", "FusionPBX", "fetch(", "POST", "migration", "functions/v1", "functions.invoke", ".insert(", ".update(", ".upsert(", ".delete("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("a real later commit in a temporary clone does not change the phase result", { timeout: 120000 }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemtel-phase27b-"));
    try {
      execFileSync("git", ["clone", "-q", "--no-checkout", root, tmp], { encoding: "utf8" });
      const env = { GIT_INDEX_FILE: path.join(tmp, ".git", "phase27b-index"), GIT_AUTHOR_NAME: "Phase 27B validation", GIT_AUTHOR_EMAIL: "phase27b@example.invalid", GIT_COMMITTER_NAME: "Phase 27B validation", GIT_COMMITTER_EMAIL: "phase27b@example.invalid" };
      const end = gitIn(tmp, ["rev-parse", PHASE27B_END]).trim();
      gitIn(tmp, ["update-ref", "HEAD", end]);
      const before = { files: phaseFiles(tmp), lines: PRODUCT.map((f) => phaseAdded(f, tmp)) };
      expect(before.files).toEqual(FILES);
      gitIn(tmp, ["read-tree", end], env);
      const blob = gitIn(tmp, ["hash-object", "-w", "--stdin"], env, "future non-protected fixture\n").trim();
      gitIn(tmp, ["update-index", "--add", "--cacheinfo", `100644,${blob},phase27b_future_fixture.txt`], env);
      const tree = gitIn(tmp, ["write-tree"], env).trim();
      const commit = gitIn(tmp, ["commit-tree", tree, "-p", end, "-m", "Temporary future fixture"], env).trim();
      gitIn(tmp, ["update-ref", "HEAD", commit]);
      expect(gitIn(tmp, ["diff", "--name-only", `${end}..HEAD`]).trim()).toBe("phase27b_future_fixture.txt");
      expect(phaseFiles(tmp)).toEqual(before.files);
      expect(phaseFiles(tmp)).toEqual(phaseFiles());
      expect(PRODUCT.map((f) => phaseAdded(f, tmp))).toEqual(before.lines);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
