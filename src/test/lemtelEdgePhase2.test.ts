import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const BASE = "224da47b7";

describe("Lemtel Edge phase 2 — offline package", () => {
  it("static verifier passes against the Phase 1 acceptance commit", () => {
    let hasBase = true;
    try { execFileSync("git", ["cat-file", "-t", BASE], { cwd: root, stdio: "ignore" }); } catch { hasBase = false; }
    const out = execFileSync("node", ["scripts/verify-lemtel-edge-phase2.mjs", ...(hasBase ? [BASE] : [])], { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/passed/);
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
