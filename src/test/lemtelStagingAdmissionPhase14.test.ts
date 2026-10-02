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

// Temporary copy with a read-only Git view: base = gates file only; every other file counts as changed.
const tempRepo = (m: any) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p14-"));
  for (const p of [m.GATES_FILE, ...m.ALLOWED]) { fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true }); fs.copyFileSync(path.join(root, p), path.join(tmp, p)); }
  const baseGates = fs.readFileSync(path.join(tmp, m.GATES_FILE), "utf8");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(tmp, path.join(d, e.name))]);
  const git = (_r: string, args: string[]) => {
    if (args[0] === "cat-file") return args[2] === "tmpbase0" ? "commit\n" : null;
    const gatesChanged = fs.readFileSync(path.join(tmp, m.GATES_FILE), "utf8") !== baseGates;
    if (args[0] === "diff" && args.includes("--")) return gatesChanged ? m.GATES_FILE + "\n" : "";
    if (args[0] === "diff") return gatesChanged ? m.GATES_FILE + "\n" : "";
    if (args[0] === "ls-files") return walk(tmp).filter((p) => p !== m.GATES_FILE).join("\n") + "\n";
    return null;
  };
  return { tmp, base: "tmpbase0", git };
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
    expect(m.verify(["--base=e224f5449"], root, { base: "e224f5449" }).code).toBe(0);
    for (const a of [["--base=0000000"], ["--oops"], ["e224f5449"], ["--base=e224f5449", "x"]]) expect(m.verify(a, root)).toEqual({ code: 2, stdout: "P14_USAGE: [--base=e224f5449]\n" });
  });

  it("temporary copy with Git view: passes, then fails on out-of-scope file, true gate and added capability", async () => {
    const m = await load();
    const { tmp, base, git } = tempRepo(m);
    try {
      expect(m.verify([], tmp, { base, git })).toEqual({ code: 0, stdout: "P14_PASSED\n" });
      fs.writeFileSync(path.join(tmp, "extra.md"), "x\n");
      expect(m.verify([], tmp, { base, git }).stdout).toMatch(/P14_SCOPE_EXACT/);
      fs.unlinkSync(path.join(tmp, "extra.md"));
      const gp = path.join(tmp, m.GATES_FILE), orig = fs.readFileSync(gp, "utf8");
      for (const gate of m.GATES) {
        fs.writeFileSync(gp, orig.replace(`${gate}: false`, `${gate}: true`));
        const r = m.verify([], tmp, { base, git });
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/P14_GATES_FALSE_UNCHANGED/);
        expect(r.stdout.split("\n").filter(Boolean).every((l: string) => /^P14_FAILED: P14_[A-Z_]+$/.test(l))).toBe(true);
      }
      fs.writeFileSync(gp, orig);
      const bad = "fet" + "ch(";
      for (const p of m.NON_DOC) {
        const fp = path.join(tmp, p), o = fs.readFileSync(fp, "utf8");
        fs.writeFileSync(fp, p.endsWith(".json") ? o.replace('"$schema"', `"x": "${bad}", "$schema"`).replace('"policy_version"', `"x": "${bad}", "policy_version"`) : o + "\n" + bad + "\n");
        expect(m.verify([], tmp, { base, git }).stdout).toMatch(/P14_NO_RUNTIME_CAPABILITY/);
        fs.writeFileSync(fp, o);
      }
      fs.appendFileSync(path.join(tmp, m.DOC), "\nDo not run do" + "cker, ss" + "h or cu" + "rl, and never use a pass" + "word.\n");
      expect(m.verify([], tmp, { base, git })).toEqual({ code: 0, stdout: "P14_PASSED\n" });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
