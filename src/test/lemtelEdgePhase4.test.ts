import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const ID = "schemas/lemtel-edge/identity";
const BASE = "8e43c8407";
const schema = (f: string) => JSON.parse(read(`${ID}/${f}.schema.json`));
const loadVerifier = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-edge-phase4.mjs")).href)).verifyPhase4 as (a: string[], r?: string) => { code: number; stdout: string };

describe("Lemtel Edge phase 4 — identity contract", () => {
  it("contract schemas have the exact fields and enums", () => {
    expect(schema("edge-capability-reference-v1").properties.capabilities.items.enum).toEqual(["sip_register", "sip_call", "call_control", "device_status"]);
    expect(schema("edge-capability-reference-v1").properties.state.enum).toEqual(["active", "expired", "revoked"]);
    expect(schema("tenant-extension-device-binding-v1").properties.binding_state.enum).toEqual(["active", "suspended", "revoked"]);
    expect(schema("edge-authorization-decision-v1").properties.decision.enum).toEqual(["allow", "deny"]);
    expect(schema("edge-authorization-decision-v1").properties.reason_code.enum).toHaveLength(8);
    expect(schema("edge-credential-resolution-result-v1").properties.state.enum).toEqual(["granted", "denied", "expired", "revoked"]);
    expect(schema("edge-revocation-notice-v1").properties.revocation_scope.enum).toEqual(["device", "capability", "binding"]);
    for (const f of fs.readdirSync(path.join(root, ID)).filter((n) => n.endsWith(".schema.json"))) {
      const s = JSON.parse(read(`${ID}/${f}`));
      expect(s.additionalProperties).toBe(false);
      expect(Object.keys(s.properties).sort()).toEqual([...s.required].sort());
      for (const [k, v] of Object.entries<any>(s.properties)) if (k.endsWith("_ref")) expect(v.pattern).toBe("^[A-Za-z0-9_-]{8,64}$");
    }
  });

  it("every Phase 2 feature gate is still false", () => {
    const vals = [...read("infra/lemtel-edge/policy/edge-feature-gates.yaml").matchAll(/^\s+[a-z_]+:\s*(\S+)/gm)].map((m) => m[1]);
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === "false")).toBe(true);
  });

  it("no Phase 2/3 source changed since the Phase 4 base", () => {
    let hasBase = true;
    try { execFileSync("git", ["cat-file", "-t", BASE], { cwd: root, stdio: "ignore" }); } catch { hasBase = false; }
    if (!hasBase) return;
    const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "infra/lemtel-edge/config", "infra/lemtel-edge/policy", "infra/lemtel-edge/edge.env.example", "infra/lemtel-edge/preflight", "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", "schemas/lemtel-edge/registration-health-v1.schema.json", "schemas/lemtel-edge/invite-push-v1.schema.json", "scripts/verify-lemtel-edge-phase2.mjs", "src/test/lemtelEdgePhase2.test.ts"], { cwd: root, encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });

  it("verifier passes, rejects a wrong attestation and bad arguments", async () => {
    const verify = await loadVerifier();
    expect(verify([`--base=${BASE}`]).code).toBe(0);
    expect(verify([]).code).toBe(0);
    expect(verify(["--base=0000000"]).stdout).toBe("P4_FAILED: P4_BASE_ATTESTATION\n");
    expect(verify(["--oops"]).code).toBe(2);
  });

  it("verifier flags a sensitive field in a temporary copy without printing content", async () => {
    const verify = await loadVerifier();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edge-p4-"));
    try {
      fs.cpSync(path.join(root, "schemas/lemtel-edge"), path.join(tmp, "schemas/lemtel-edge"), { recursive: true });
      fs.cpSync(path.join(root, "docs/lemtel-edge"), path.join(tmp, "docs/lemtel-edge"), { recursive: true });
      fs.cpSync(path.join(root, "infra/lemtel-edge"), path.join(tmp, "infra/lemtel-edge"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "scripts")); fs.mkdirSync(path.join(tmp, "src/test"), { recursive: true });
      for (const f of ["scripts/verify-lemtel-edge-phase4.mjs", "scripts/verify-lemtel-edge-phase2.mjs", "src/test/lemtelEdgePhase2.test.ts"]) fs.copyFileSync(path.join(root, f), path.join(tmp, f));
      expect(verify([], tmp).code).toBe(0);
      const p = path.join(tmp, ID, "edge-capability-reference-v1.schema.json");
      const s = JSON.parse(fs.readFileSync(p, "utf8"));
      s.properties.sip_password = { type: "string" }; s.required.push("sip_password");
      fs.writeFileSync(p, JSON.stringify(s));
      const r = verify([], tmp);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/P4_SENSITIVE_FIELDS_ABSENT/);
      expect(r.stdout.split("\n").filter(Boolean).every((l) => /^P4_FAILED: P4_[A-Z0-9_]+$/.test(l))).toBe(true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
