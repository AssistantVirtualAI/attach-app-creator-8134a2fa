import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const PBX = "schemas/lemtel-edge/cutover";
const BASE = "a633acd0c";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const schema = (n: string) => JSON.parse(read(`${PBX}/${n}.schema.json`));
const load = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-edge-phase6.mjs")).href)).verifyPhase6 as (a: string[], r?: string) => { code: number; stdout: string };
const onlyIds = (s: string) => s.split("\n").filter(Boolean).every((l) => /^P6_FAILED: P6_[A-Z0-9_]+$/.test(l));

const copy = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edge-p6-"));
  for (const d of ["schemas/lemtel-edge", "docs/lemtel-edge", "infra/lemtel-edge"]) fs.cpSync(path.join(root, d), path.join(tmp, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.copyFileSync(path.join(root, "scripts/verify-lemtel-edge-phase6.mjs"), path.join(tmp, "scripts/verify-lemtel-edge-phase6.mjs"));
  return tmp;
};
const editSchema = (tmp: string, n: string, fn: (s: any) => void) => {
  const p = path.join(tmp, PBX, `${n}.schema.json`);
  const s = JSON.parse(fs.readFileSync(p, "utf8")); fn(s); fs.writeFileSync(p, JSON.stringify(s));
};

describe("Lemtel Edge phase 6 — existing-app coexistence", () => {
  it("schemas have exact fields and enums", () => {
    const req = (n: string) => schema(n).required;
    expect(req("device-routing-assignment-v1")).toEqual(["version", "assignment_ref", "tenant_ref", "extension_ref", "device_ref", "routing_mode", "assignment_state", "issued_at", "expires_at"]);
    expect(req("device-routing-decision-v1")).toEqual(["version", "decision_ref", "tenant_ref", "extension_ref", "device_ref", "assignment_ref", "routing_mode", "decision", "reason_code", "decided_at"]);
    expect(req("device-migration-evidence-v1")).toEqual(["version", "evidence_ref", "tenant_ref", "extension_ref", "device_ref", "assignment_ref", "evidence_state", "validation_scope", "observed_at"]);
    expect(req("device-rollback-notice-v1")).toEqual(["version", "notice_ref", "tenant_ref", "extension_ref", "device_ref", "assignment_ref", "rollback_scope", "rollback_state", "issued_at"]);
    expect(schema("device-routing-assignment-v1").properties.routing_mode.enum).toEqual(["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"]);
    expect(schema("device-routing-decision-v1").properties.reason_code.enum).toHaveLength(8);
    expect(schema("device-migration-evidence-v1").properties.validation_scope.enum).toHaveLength(5);
    expect(schema("device-rollback-notice-v1").properties.rollback_scope.enum).toEqual(["edge_pilot", "shadow_observe"]);
    for (const f of fs.readdirSync(path.join(root, PBX)).filter((n) => n.endsWith(".schema.json"))) {
      const s = JSON.parse(read(`${PBX}/${f}`));
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

  it("verifier passes, rejects a wrong attestation and unknown arguments", async () => {
    const v = await load();
    expect(v([`--base=${BASE}`])).toEqual({ code: 0, stdout: `P6_PASSED (attested base ${BASE})\n` });
    expect(v([])).toEqual({ code: 0, stdout: "P6_PASSED\n" });
    expect(v(["--base=0000000"]).stdout).toBe("P6_FAILED: P6_BASE_ATTESTATION\n");
    expect(v(["--base=xyz"])).toEqual({ code: 2, stdout: "P6_USAGE: [--base=a633acd0c]\n" });
    expect(v(["--oops"])).toEqual({ code: 2, stdout: "P6_USAGE: [--base=a633acd0c]\n" });
  });

  it("sensitive field and non-opaque ref fail with stable IDs only", async () => {
    const v = await load();
    const tmp = copy();
    try {
      expect(v([], tmp).code).toBe(0);
      editSchema(tmp, "device-routing-decision-v1", (s) => { s.properties.sip_password = { type: "string" }; s.required.push("sip_password"); });
      editSchema(tmp, "device-rollback-notice-v1", (s) => { s.properties.tenant_ref.pattern = "^.*$"; });
      const r = v([], tmp);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/P6_SENSITIVE_FIELDS_ABSENT/);
      expect(r.stdout).toMatch(/P6_OPAQUE_REF_PATTERN/);
      expect(onlyIds(r.stdout)).toBe(true);
      expect(r.stdout).not.toMatch(/sip_password|\^\.\*\$/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("defaults are existing_direct / not_started and pilot prerequisites are exact", () => {
    const p = JSON.parse(read(`${PBX}/cutover-policy.json`));
    expect(p.current_default_routing_mode).toBe("existing_direct");
    expect(p.current_evidence_state).toBe("not_started");
    expect(p.edge_pilot_prerequisites).toEqual(["phase1_runtime_passed", "edge_runtime_approved", "fusionpbx_nonproduction_approved", "device_capability_approved", "pilot_approval_recorded", "existing_route_withdrawn", "rollback_path_verified"]);
  });

  it("frozen Phase 2 config, Phase 3 preflight and Phase 4 identity and Phase 5 PBX package unchanged since base", () => {
    try { execFileSync("git", ["cat-file", "-t", BASE], { cwd: root, stdio: "ignore" }); } catch { return; }
    const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", "schemas/lemtel-edge/registration-health-v1.schema.json", "schemas/lemtel-edge/invite-push-v1.schema.json", "schemas/lemtel-edge/identity", "schemas/lemtel-edge/pbx", "docs/lemtel-edge/phase-5-pbx-adapter-contract.md", "docs/lemtel-edge/phase-5-provisioning-state-machine.md", "docs/lemtel-edge/phase-5-fusionpbx-prerequisites.md", "docs/lemtel-edge/phase-5-pbx-adapter-threat-model.md", "scripts/verify-lemtel-edge-phase5.mjs"], { cwd: root, encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });
});
