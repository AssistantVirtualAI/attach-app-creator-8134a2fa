import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const BASE = "224da47b7";

describe("Lemtel Edge phase 2 — offline package", () => {
  const run = (args: string[]) => spawnSync("node", ["scripts/verify-lemtel-edge-phase2.mjs", ...args], { cwd: root, encoding: "utf8" });
  const USAGE = "Usage: node scripts/verify-lemtel-edge-phase2.mjs --invariants | --historical-acceptance";
  const hasCommit = (c: string) => { try { execFileSync("git", ["cat-file", "-t", c], { cwd: root, stdio: "ignore" }); return true; } catch { return false; } };
  const historicalAvailable = hasCommit("224da47b7") && hasCommit("cc28b5a80");

  it("--invariants passes with the exact success line", () => {
    const r = run(["--invariants"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("✓ Lemtel Edge Phase 2 invariants passed");
  });

  it.skipIf(!historicalAvailable)("--historical-acceptance passes on 224da47b7..cc28b5a80 (skipped when those commits are not local)", () => {
    const r = run(["--historical-acceptance"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("✓ Lemtel Edge Phase 2 historical acceptance passed");
  });

  it("later-phase files do not make --invariants fail", () => {
    expect(fs.existsSync(path.join(root, "scripts/verify-lemtel-edge-phase4.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(root, "schemas/lemtel-edge/identity"))).toBe(true);
    expect(run(["--invariants"]).status).toBe(0);
  });

  it("raw base hash, unknown flag, no args and extra args are rejected with the usage line", () => {
    for (const a of [["224da47b7"], ["--oops"], [], ["--invariants", "--historical-acceptance"]]) {
      const r = run(a);
      expect(r.status).toBe(2);
      expect(r.stderr.trim()).toBe(USAGE);
      expect(r.stdout).toBe("");
    }
  });

  it("every feature gate is false", () => {
    const g = read("infra/lemtel-edge/policy/edge-feature-gates.yaml");
    const vals = [...g.matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals.length).toBe(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("Kamailio template is default deny with CORS disabled", () => {
    const active = read("infra/lemtel-edge/config/kamailio.cfg").split("\n").filter((l) => !l.trim().startsWith("#") || l.trim().startsWith("#!")).join("\n");
    expect(active).toMatch(/modparam\("websocket", "cors_mode", 0\)/);
    expect(active).toMatch(/sl_send_reply\("503", "Lemtel Edge disabled"\)/);
    expect(active).not.toMatch(/t_relay|rtpengine_(offer|answer|manage|delete)|www_authorize|http_client|opensips/i);
  });

  it("schemas reject additional properties at every object", () => {
    for (const f of ["edge-event-envelope-v1", "registration-health-v1", "invite-push-v1"]) {
      const s = JSON.parse(read(`schemas/lemtel-edge/${f}.schema.json`));
      expect(s.additionalProperties).toBe(false);
      expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
  });

  it("env example lists blank values only", () => {
    for (const l of read("infra/lemtel-edge/edge.env.example").split("\n").filter(Boolean)) expect(l).toMatch(/^LEMTEL_EDGE_[A-Z_]+=$/);
  });

  it("no runtime file exists in the package", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]);
    expect(walk(path.join(root, "infra/lemtel-edge")).filter((n) => /Dockerfile|compose|\.sh$/i.test(n))).toEqual([]);
  });
});
