import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROUTING_MODES, REQUESTED_MODES, REASON_CODES, PILOT_PREREQUISITES, evaluateCutoverPolicy, type CutoverPolicyInput } from "../src/policy/cutover.js";

const OK: CutoverPolicyInput = {
  requestedMode: "edge_pilot", currentActiveMode: "none", phase1Runtime: "passed", edgeRuntime: "approved", identityScope: "authorized",
  capability: "approved", pilotApproval: "recorded", nonProductionApproval: "approved", directRoute: "withdrawn", rollbackPath: "verified",
};
const BAD: CutoverPolicyInput = {
  requestedMode: "existing_direct", currentActiveMode: "edge_pilot", phase1Runtime: "pending", edgeRuntime: "disabled", identityScope: "denied",
  capability: "invalid", pilotApproval: "missing", nonProductionApproval: "missing", directRoute: "active", rollbackPath: "unverified",
};
const freeze = <T>(o: T): T => Object.freeze(o);

test("constants have the exact ordered values", () => {
  assert.deepEqual([...ROUTING_MODES], ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"]);
  assert.deepEqual([...REQUESTED_MODES], [...ROUTING_MODES]);
  assert.deepEqual([...REASON_CODES], ["existing_route_required", "phase1_runtime_pending", "edge_disabled", "device_not_authorized", "capability_invalid", "pilot_not_approved", "prerequisites_incomplete", "rollback_required"]);
  assert.deepEqual([...PILOT_PREREQUISITES], ["phase1_runtime_passed", "edge_runtime_approved", "upstream_nonproduction_approved", "device_capability_approved", "pilot_approval_recorded", "existing_route_withdrawn", "rollback_path_verified"]);
});

test("existing_direct always allows with every prerequisite missing", () => {
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...BAD })), { decision: "allow", effectiveMode: "existing_direct", reasonCode: "existing_route_required" });
});

test("strict precedence under simultaneous failures", () => {
  const gates: [Partial<CutoverPolicyInput>, string][] = [
    [{ phase1Runtime: "pending" }, "phase1_runtime_pending"], [{ edgeRuntime: "disabled" }, "edge_disabled"],
    [{ identityScope: "denied" }, "device_not_authorized"], [{ capability: "invalid" }, "capability_invalid"],
    [{ pilotApproval: "missing" }, "pilot_not_approved"], [{ nonProductionApproval: "missing" }, "prerequisites_incomplete"],
    [{ directRoute: "active" }, "existing_route_required"], [{ rollbackPath: "unverified" }, "rollback_required"],
    [{ currentActiveMode: "existing_direct" }, "existing_route_required"],
  ];
  for (const mode of ["edge_pilot", "shadow_observe"] as const) {
    for (let i = 0; i < gates.length; i++) {
      let input: CutoverPolicyInput = { ...OK, requestedMode: mode };
      for (const [bad] of gates.slice(i)) input = { ...input, ...bad };
      assert.deepEqual(evaluateCutoverPolicy(freeze(input)), { decision: "deny", effectiveMode: mode, reasonCode: gates[i][1] });
    }
  }
});

test("fully approved edge_pilot and shadow_observe are allowed (hypothetical)", () => {
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...OK })), { decision: "allow", effectiveMode: "edge_pilot", reasonCode: "existing_route_required" });
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...OK, requestedMode: "shadow_observe" })), { decision: "allow", effectiveMode: "shadow_observe", reasonCode: "existing_route_required" });
  const doc = readFileSync(join(import.meta.dirname, "../../../docs/lemtel-control-plane/phase-7-cutover-policy.md"), "utf8");
  assert.match(doc, /shadow_observe` does not authorize registration, signalling or media/);
});

test("pilot rejects any non-none current active mode", () => {
  for (const m of ROUTING_MODES) assert.equal(evaluateCutoverPolicy(freeze({ ...OK, currentActiveMode: m })).decision, "deny");
});

test("rollback rules", () => {
  const rb = { ...OK, requestedMode: "existing_direct_rollback" as const };
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...rb, currentActiveMode: "shadow_observe" })), { decision: "deny", effectiveMode: "existing_direct", reasonCode: "rollback_required" });
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...rb, currentActiveMode: "edge_pilot", rollbackPath: "unverified" })), { decision: "deny", effectiveMode: "existing_direct", reasonCode: "rollback_required" });
  assert.deepEqual(evaluateCutoverPolicy(freeze({ ...rb, currentActiveMode: "edge_pilot" })), { decision: "allow", effectiveMode: "existing_direct", reasonCode: "existing_route_required" });
});

test("frozen input is unchanged and results are deterministic", () => {
  const input = freeze({ ...OK });
  const snap = JSON.stringify(input);
  const a = evaluateCutoverPolicy(input);
  for (let i = 0; i < 5; i++) assert.deepEqual(evaluateCutoverPolicy(input), a);
  assert.equal(JSON.stringify(input), snap);
});

test("module source is pure", () => {
  const s = readFileSync(join(import.meta.dirname, "../src/policy/cutover.ts"), "utf8");
  assert.doesNotMatch(s, /^\s*import\s/m);
  assert.doesNotMatch(s, /fusionpbx|\\u|\\x/i);
  assert.doesNotMatch(s, /require\(|import\(|process\.|Date\b|Math\.random|randomUUID|fetch\(|setTimeout|setInterval|node:|fastify|redis|\bpg\b|readFile|writeFile|\.(get|post|put|patch|delete|route)\(/i);
});
