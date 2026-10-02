import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const json = (p: string) => JSON.parse(read(p));
const load = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-staging-admission-phase14.mjs")).href);
const clone = (o: any) => JSON.parse(JSON.stringify(o));

// Genuine temporary Git repository built with local plumbing and command-local identity:
// base commit (gates only) -> end commit (gates + Phase 14 package [+ extra]) -> optional later commit.
const tempRepo = (m: any, o: { extraInRange?: boolean; later?: boolean } = {}) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p14-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  const put = (p: string, src?: string) => { fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true }); src === undefined ? fs.copyFileSync(path.join(root, p), path.join(tmp, p)) : fs.writeFileSync(path.join(tmp, p), src); g("update-index", "--add", p); };
  const commit = (msg: string, parent?: string) => { const tree = g("write-tree"); const c = g("commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", msg); g("update-ref", "HEAD", c); expect(g("cat-file", "-t", c)).toBe("commit"); return c; };
  g("init", "-q");
  put(m.GATES_FILE);
  const base = commit("base");
  for (const p of m.ALLOWED) put(p);
  if (o.extraInRange) put("unexpected/in-range.md", "x\n");
  const end = commit("phase14", base);
  let later: string | undefined;
  if (o.later) { put("docs/later-phase/placeholder.md", "later\n"); later = commit("later", end); }
  return { tmp, base, end, later, g };
};

describe("Lemtel staging admission phase 14.0 — offline, denial-first", () => {
  const ID = "abcd-1234";
  const checks = (v: boolean) => (m: any) => Object.fromEntries(m.PREREQS.map((p: string) => [p, v]));

  it("valid objects accepted; deletions, unknown fields and bad enums rejected", async () => {
    const m = await load();
    const rq = json(m.REQUEST), dc = json(m.DECISION), ev = json(m.EVIDENCE);
    const objs: [any, any][] = [
      [rq, { kind: "staging_admission", request_id: ID, evidence_ref: ID, checks: checks(true)(m) }],
      [dc, { kind: "staging_admission_decision", request_id: ID, decision_ref: ID, decision: "denied", reason_codes: ["unmet_secrets_owner_named"], ...Object.fromEntries(m.FLAGS.map((f: string) => [f, false])) }],
      [ev, { kind: "staging_admission_evidence", request_id: ID, evidence_ref: ID, evidence: Object.fromEntries(m.PREREQS.map((p: string) => [p, "not_provided"])) }],
    ];
    for (const [s, o] of objs) {
      expect(m.validate(s, o)).toBe(true);
      for (const k of Object.keys(o)) { const b = clone(o); delete b[k]; expect(m.validate(s, b)).toBe(false); }
      expect(m.validate(s, { ...o, extra: 1 })).toBe(false);
      expect(m.validate(s, { ...o, kind: "other" })).toBe(false);
      for (const bad of ["Bad_ID", "short", "x".repeat(65), "-abcdefgh"]) expect(m.validate(s, { ...o, request_id: bad })).toBe(false);
    }
    const [[, r], [, d], [, e]] = objs;
    for (const p of m.PREREQS) {
      const a = clone(r); delete a.checks[p]; expect(m.validate(rq, a)).toBe(false);
      const b = clone(r); b.checks[p] = "true"; expect(m.validate(rq, b)).toBe(false);
      const c = clone(e); c.evidence[p] = "approved"; expect(m.validate(ev, c)).toBe(false);
      const x = clone(e); delete x.evidence[p]; expect(m.validate(ev, x)).toBe(false);
    }
    expect(m.validate(rq, { ...r, checks: { ...r.checks, extra: true } })).toBe(false);
    expect(m.validate(ev, { ...e, evidence: { ...e.evidence, note: "verified" } })).toBe(false);
    expect(m.validate(dc, { ...d, decision: "pending" })).toBe(false);
    expect(m.validate(dc, { ...d, reason_codes: ["free text"] })).toBe(false);
    expect(m.validate(dc, { ...d, reason_codes: ["unmet_secrets_owner_named", "unmet_secrets_owner_named"] })).toBe(false);
    expect(m.validate(dc, { ...d, reason_codes: [] })).toBe(false);
    for (const f of m.FLAGS) expect(m.validate(dc, { ...d, [f]: true })).toBe(false);
    expect(m.checkRequestSchema(rq) && m.checkDecisionSchema(dc) && m.checkEvidenceSchema(ev)).toBe(true);
  });

  it("policy is exact and denied; any boolean change is rejected", async () => {
    const m = await load();
    const p = json(m.POLICY);
    expect(m.checkPolicy(p)).toBe(true);
    expect(p.current_decision).toBe("denied");
    expect(m.outcome(p.prerequisites)).toBe("denied");
    for (const k of m.PREREQS) { const b = clone(p); b.prerequisites[k] = !b.prerequisites[k]; expect(m.checkPolicy(b)).toBe(false); }
    for (const k of ["offline_only", ...m.FLAGS]) { const b = clone(p); b[k] = !b[k]; expect(m.checkPolicy(b)).toBe(false); }
    for (const k of ["default_decision", "current_decision"]) { const b = clone(p); b[k] = "admitted"; expect(m.checkPolicy(b)).toBe(false); }
  });

  it("admitted is rejected while any prerequisite is false", async () => {
    const m = await load();
    const dc = json(m.DECISION);
    const adm = { kind: "staging_admission_decision", request_id: ID, decision_ref: ID, decision: "admitted", reason_codes: [], ...Object.fromEntries(m.FLAGS.map((f: string) => [f, false])) };
    expect(m.decisionConsistent(dc, adm, checks(true)(m))).toBe(true);
    for (const k of m.PREREQS) expect(m.decisionConsistent(dc, adm, { ...checks(true)(m), [k]: false })).toBe(false);
    expect(m.decisionConsistent(dc, adm, json(m.POLICY).prerequisites)).toBe(false);
    expect(m.validate(dc, { ...adm, reason_codes: ["unmet_pbx_integration_approved"] })).toBe(false);
  });

  it("verifier passes; invalid arguments return code 2 with only the usage line", async () => {
    const m = await load();
    expect(m.verify(["--base=e224f5449"], root)).toEqual({ code: 0, stdout: "P14_PASSED (attested base e224f5449)\n" });
    for (const a of [["--base=0000000"], ["--oops"], ["e224f5449"], ["--base=e224f5449", "x"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "P14_USAGE: [--base=e224f5449]\n" });
  });

  it("real temporary Git repository: passes, then fails on out-of-scope file, true gate and added capability", async () => {
    const m = await load();
    const { tmp, base, end } = tempRepo(m);
    try {
      expect(m.verify([], tmp, { base, end })).toEqual({ code: 0, stdout: "P14_PASSED\n" });
      fs.writeFileSync(path.join(tmp, "extra.md"), "x\n");
      expect(m.verify([], tmp, { base, end }).stdout).toMatch(/P14_SCOPE_EXACT/);
      fs.unlinkSync(path.join(tmp, "extra.md"));
      const gp = path.join(tmp, m.GATES_FILE), orig = fs.readFileSync(gp, "utf8");
      for (const gate of m.GATES) {
        fs.writeFileSync(gp, orig.replace(`${gate}: false`, `${gate}: true`));
        const r = m.verify([], tmp, { base, end });
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/P14_GATES_FALSE_UNCHANGED/);
        expect(r.stdout.split("\n").filter(Boolean).every((l: string) => /^P14_FAILED: P14_[A-Z_]+$/.test(l))).toBe(true);
      }
      fs.writeFileSync(gp, orig);
      const bad = "fet" + "ch(";
      for (const p of m.NON_DOC) {
        const fp = path.join(tmp, p), o = fs.readFileSync(fp, "utf8");
        fs.writeFileSync(fp, p.endsWith(".json") ? o.replace('"$schema"', `"x": "${bad}", "$schema"`).replace('"policy_version"', `"x": "${bad}", "policy_version"`) : o + "\n" + bad + "\n");
        expect(m.verify([], tmp, { base, end }).stdout).toMatch(/P14_NO_RUNTIME_CAPABILITY/);
        fs.writeFileSync(fp, o);
      }
      fs.appendFileSync(path.join(tmp, m.DOC), "\nDo not run do" + "cker, ss" + "h or cu" + "rl, and never use a pass" + "word.\n");
      expect(m.verify([], tmp, { base, end })).toEqual({ code: 0, stdout: "P14_PASSED\n" });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("frozen historical range: later tracked file ignored; in-range extra, missing or reversed range fail", async () => {
    const m = await load();
    expect(m.PHASE14_BASE).toBe("e224f5449");
    expect(m.PHASE14_END).toBe("56af2db13");
    const a = tempRepo(m, { later: true });
    try {
      expect(a.g("ls-tree", "-r", "--name-only", "HEAD")).toMatch(/docs\/later-phase\/placeholder\.md/);
      expect(m.verify([], a.tmp, { base: a.base, end: a.end })).toEqual({ code: 0, stdout: "P14_PASSED\n" });
      fs.writeFileSync(path.join(a.tmp, "untracked.txt"), "x\n");
      expect(m.verify([], a.tmp, { base: a.base, end: a.end }).stdout).toMatch(/P14_SCOPE_EXACT/);
      fs.unlinkSync(path.join(a.tmp, "untracked.txt"));
      expect(m.verify([], a.tmp, { base: a.end, end: a.base }).stdout).toMatch(/P14_RANGE_ORDER/);
      expect(m.verify([], a.tmp, { base: a.base, end: "0".repeat(40) }).stdout).toMatch(/P14_END_MISSING/);
      expect(m.verify([], a.tmp, { base: "0".repeat(40), end: a.end }).stdout).toMatch(/P14_BASE_MISSING/);
    } finally { fs.rmSync(a.tmp, { recursive: true, force: true }); }
    const b = tempRepo(m, { extraInRange: true });
    try { expect(m.verify([], b.tmp, { base: b.base, end: b.end }).stdout).toMatch(/P14_SCOPE_EXACT/); }
    finally { fs.rmSync(b.tmp, { recursive: true, force: true }); }
    const src = read(m.SELF) + read("src/test/lemtelStagingAdmissionPhase14.test.ts");
    expect(src).not.toMatch(new RegExp("opts\\.g" + "it|vi\\.mo" + "ck|mockImplem" + "entation"));
  });

  it("each prohibited capability is rejected in non-document files", async () => {
    const m = await load();
    const caps = ["node:ht" + "tp", "fet" + "ch(", "Web" + "Socket", "she" + "ll: true", "exec" + "Sync(", "spa" + "wn(", "np" + "m install", "proc" + "ess.env.X", "sup" + "abase", "ht" + "tps://example.invalid", "10.0" + ".0.1", "spawn" + "Sync(\"ba" + "sh\")"];
    for (const p of m.NON_DOC) { const t = read(p); expect(m.checkCapabilities(p, t)).toBe(true); for (const c of caps) expect(m.checkCapabilities(p, t + "\n" + c + "\n")).toBe(false); }
    expect(m.checkCapabilities(m.SELF, read(m.SELF) + "\nwrite" + "FileSync(x)\n")).toBe(false);
  });

  it("verifier writes no files and runs only local Git", async () => {
    const m = await load();
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    m.verify([], root);
    const { tmp, base, end } = tempRepo(m, { later: true });
    try { m.verify([], tmp, { base, end }); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe(before);
    const src = read(m.SELF);
    expect([...src.matchAll(/\b(execFileSync|spawnSync)\s*\(\s*([^,)]*)/g)].map((x) => x[2])).toEqual(['"git"']);
    expect(m.checkCapabilities(m.SELF, src)).toBe(true);
  });

  it("all ten Edge gates remain literal false", async () => {
    const m = await load();
    expect(m.gatesAllFalse(read(m.GATES_FILE))).toBe(true);
  });
});
