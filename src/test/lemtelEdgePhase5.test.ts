import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const PBX = "schemas/lemtel-edge/pbx";
const BASE = "3cc4f5285";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const schema = (n: string) => JSON.parse(read(`${PBX}/${n}.schema.json`));
const load = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-edge-phase5.mjs")).href)).verifyPhase5 as (a: string[], r?: string) => { code: number; stdout: string };
const onlyIds = (s: string) => s.split("\n").filter(Boolean).every((l) => /^P5_FAILED: P5_[A-Z0-9_]+$/.test(l));

const copy = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edge-p5-"));
  for (const d of ["schemas/lemtel-edge", "docs/lemtel-edge", "infra/lemtel-edge"]) fs.cpSync(path.join(root, d), path.join(tmp, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.copyFileSync(path.join(root, "scripts/verify-lemtel-edge-phase5.mjs"), path.join(tmp, "scripts/verify-lemtel-edge-phase5.mjs"));
  return tmp;
};
const editSchema = (tmp: string, n: string, fn: (s: any) => void) => {
  const p = path.join(tmp, PBX, `${n}.schema.json`);
  const s = JSON.parse(fs.readFileSync(p, "utf8")); fn(s); fs.writeFileSync(p, JSON.stringify(s));
};

describe("Lemtel Edge phase 5 — offline PBX adapter contract", () => {
  it("schemas have exact fields and enums", () => {
    const req = (n: string) => schema(n).required;
    expect(req("pbx-tenant-binding-v1")).toEqual(["version", "tenant_ref", "upstream_ref", "binding_state", "created_at", "updated_at"]);
    expect(req("pbx-extension-desired-state-v1")).toEqual(["version", "operation_ref", "tenant_ref", "extension_ref", "desired_state", "requested_at"]);
    expect(req("pbx-extension-observed-state-v1")).toEqual(["version", "observation_ref", "tenant_ref", "extension_ref", "observed_state", "observation_state", "observed_at"]);
    expect(req("pbx-provisioning-request-v1")).toEqual(["version", "operation_ref", "tenant_ref", "extension_ref", "device_ref", "capability_ref", "change_kind", "requested_at"]);
    expect(req("pbx-provisioning-result-v1")).toEqual(["version", "operation_ref", "tenant_ref", "extension_ref", "device_ref", "result_state", "reason_code", "resolved_at"]);
    expect(schema("pbx-extension-observed-state-v1").properties.observation_state.enum).toEqual(["not_connected", "stale", "current"]);
    expect(schema("pbx-provisioning-request-v1").properties.change_kind.enum).toEqual(["provision_extension", "suspend_extension", "revoke_device", "refresh_binding"]);
    expect(schema("pbx-provisioning-result-v1").properties.result_state.enum).toEqual(["queued", "applied", "rejected", "unknown"]);
    expect(schema("pbx-provisioning-result-v1").properties.reason_code.enum).toHaveLength(7);
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
    expect(v([`--base=${BASE}`])).toEqual({ code: 0, stdout: `P5_PASSED (attested base ${BASE})\n` });
    expect(v([])).toEqual({ code: 0, stdout: "P5_PASSED\n" });
    expect(v(["--base=0000000"]).stdout).toBe("P5_FAILED: P5_BASE_ATTESTATION\n");
    expect(v(["--oops"])).toEqual({ code: 2, stdout: "P5_USAGE: [--base=3cc4f5285]\n" });
  });

  it("sensitive field and non-opaque ref fail with stable IDs only", async () => {
    const v = await load();
    const tmp = copy();
    try {
      expect(v([], tmp).code).toBe(0);
      editSchema(tmp, "pbx-provisioning-request-v1", (s) => { s.properties.sip_password = { type: "string" }; s.required.push("sip_password"); });
      editSchema(tmp, "pbx-tenant-binding-v1", (s) => { s.properties.tenant_ref.pattern = "^.*$"; });
      const r = v([], tmp);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/P5_SENSITIVE_FIELDS_ABSENT/);
      expect(r.stdout).toMatch(/P5_OPAQUE_REF_PATTERN/);
      expect(onlyIds(r.stdout)).toBe(true);
      expect(r.stdout).not.toMatch(/sip_password|\^\.\*\$/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("not_connected remains the declared current observation state", () => {
    expect(JSON.parse(read(`${PBX}/pbx-adapter-policy.json`)).current_observation_state).toBe("not_connected");
  });

  it("frozen Phase 2 config, Phase 3 preflight and Phase 4 identity schemas unchanged since base", () => {
    try { execFileSync("git", ["cat-file", "-t", BASE], { cwd: root, stdio: "ignore" }); } catch { return; }
    const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "infra/lemtel-edge", "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", "schemas/lemtel-edge/registration-health-v1.schema.json", "schemas/lemtel-edge/invite-push-v1.schema.json", "schemas/lemtel-edge/identity"], { cwd: root, encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });
});
