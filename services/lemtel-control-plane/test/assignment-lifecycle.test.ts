import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROUTING_MODES, ASSIGNMENT_STATES, LIFECYCLE_EVENTS, LIFECYCLE_ACTIONS, LIFECYCLE_REASONS,
  reduceAssignmentLifecycle, type AssignmentLifecycleInput,
} from "../src/policy/assignment-lifecycle.js";

const r = (i: AssignmentLifecycleInput) => reduceAssignmentLifecycle(Object.freeze({ ...i }));
const MODES_N = ["none", ...ROUTING_MODES] as const;
const STATES_N = ["none", ...ASSIGNMENT_STATES] as const;
const all = (): AssignmentLifecycleInput[] => {
  const out: AssignmentLifecycleInput[] = [];
  for (const requestedMode of ROUTING_MODES) for (const currentMode of MODES_N) for (const currentState of STATES_N)
    for (const policyDecision of ["allow", "deny"] as const) for (const event of LIFECYCLE_EVENTS)
      out.push({ requestedMode, currentMode, currentState, policyDecision, event });
  return out;
};
const isHold = (i: AssignmentLifecycleInput, reason: string) =>
  assert.deepEqual(r(i), { nextMode: i.currentMode, nextState: i.currentState, action: "hold", reasonCode: reason });

test("constants have the exact ordered values", () => {
  assert.deepEqual([...ROUTING_MODES], ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"]);
  assert.deepEqual([...ASSIGNMENT_STATES], ["pending", "active", "revoked", "expired"]);
  assert.deepEqual([...LIFECYCLE_EVENTS], ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"]);
  assert.deepEqual([...LIFECYCLE_ACTIONS], ["hold", "issue_pending", "activate", "request_revocation", "revoke", "restore_direct", "expire"]);
  assert.deepEqual([...LIFECYCLE_REASONS], ["policy_denied", "existing_direct_default", "issued", "activated", "revocation_requested", "revoked", "direct_restored", "expired", "invalid_transition"]);
});

test("deeply frozen input is unchanged and results are deterministic", () => {
  for (const i of all()) {
    const f = Object.freeze({ ...i });
    assert.ok(Object.isFrozen(f));
    const snap = JSON.stringify(f);
    const a = reduceAssignmentLifecycle(f);
    assert.deepEqual(reduceAssignmentLifecycle(f), a);
    assert.equal(JSON.stringify(f), snap);
  }
});

test("policy denial wins over every event", () => {
  for (const i of all().filter((x) => x.policyDecision === "deny")) isHold(i, "policy_denied");
  isHold({ requestedMode: "edge_pilot", currentMode: "none", currentState: "none", policyDecision: "deny", event: "policy_evaluated" }, "policy_denied");
});

test("future modes issue pending only from none with none/revoked/expired", () => {
  for (const m of ["edge_pilot", "shadow_observe"] as const) {
    for (const s of ["none", "revoked", "expired"] as const)
      assert.deepEqual(r({ requestedMode: m, currentMode: "none", currentState: s, policyDecision: "allow", event: "policy_evaluated" }), { nextMode: m, nextState: "pending", action: "issue_pending", reasonCode: "issued" });
    for (const s of ["pending", "active"] as const) isHold({ requestedMode: m, currentMode: "none", currentState: s, policyDecision: "allow", event: "policy_evaluated" }, "invalid_transition");
  }
});

test("active or inconsistent snapshots cannot issue a future assignment", () => {
  for (const m of ["edge_pilot", "shadow_observe"] as const)
    for (const cm of ["existing_direct", "edge_pilot", "shadow_observe", "existing_direct_rollback"] as const)
      for (const s of STATES_N) isHold({ requestedMode: m, currentMode: cm, currentState: s, policyDecision: "allow", event: "policy_evaluated" }, "invalid_transition");
});

test("activation only promotes matching pending edge/shadow", () => {
  for (const i of all().filter((x) => x.policyDecision === "allow" && x.event === "activation_confirmed")) {
    const ok = i.requestedMode === i.currentMode && (i.requestedMode === "edge_pilot" || i.requestedMode === "shadow_observe") && i.currentState === "pending";
    if (ok) assert.deepEqual(r(i), { nextMode: i.requestedMode, nextState: "active", action: "activate", reasonCode: "activated" });
    else isHold(i, "invalid_transition");
  }
});

test("rollback request rules", () => {
  for (const s of ["pending", "active"] as const)
    assert.deepEqual(r({ requestedMode: "existing_direct_rollback", currentMode: "edge_pilot", currentState: s, policyDecision: "allow", event: "policy_evaluated" }), { nextMode: "edge_pilot", nextState: s, action: "request_revocation", reasonCode: "revocation_requested" });
  for (const s of STATES_N) isHold({ requestedMode: "existing_direct_rollback", currentMode: "shadow_observe", currentState: s, policyDecision: "allow", event: "policy_evaluated" }, "invalid_transition");
  for (const s of ["none", "revoked", "expired"] as const) isHold({ requestedMode: "existing_direct_rollback", currentMode: "edge_pilot", currentState: s, policyDecision: "allow", event: "policy_evaluated" }, "invalid_transition");
});

test("revocation confirmation only revokes edge pilot pending/active and never restores direct", () => {
  for (const i of all().filter((x) => x.policyDecision === "allow" && x.event === "revocation_confirmed")) {
    const ok = i.requestedMode === "existing_direct_rollback" && i.currentMode === "edge_pilot" && (i.currentState === "pending" || i.currentState === "active");
    if (ok) assert.deepEqual(r(i), { nextMode: "none", nextState: "revoked", action: "revoke", reasonCode: "revoked" });
    else isHold(i, "invalid_transition");
    if (r(i).action !== "hold") assert.notEqual(r(i).nextMode, "existing_direct");
  }
});

test("direct restoration only after none/revoked with explicit event", () => {
  for (const i of all().filter((x) => x.policyDecision === "allow" && x.event === "direct_restore_confirmed")) {
    const ok = i.requestedMode === "existing_direct" && i.currentMode === "none" && i.currentState === "revoked";
    if (ok) assert.deepEqual(r(i), { nextMode: "existing_direct", nextState: "active", action: "restore_direct", reasonCode: "direct_restored" });
    else isHold(i, "invalid_transition");
  }
});

test("expiry only affects pending/active edge/shadow and never restores direct", () => {
  for (const i of all().filter((x) => x.policyDecision === "allow" && x.event === "expiry_observed")) {
    const ok = (i.currentMode === "edge_pilot" || i.currentMode === "shadow_observe") && (i.currentState === "pending" || i.currentState === "active");
    if (ok) assert.deepEqual(r(i), { nextMode: "none", nextState: "expired", action: "expire", reasonCode: "expired" });
    else isHold(i, "invalid_transition");
    assert.notEqual(r(i).action, "restore_direct");
    assert.notEqual(r(i).action, "activate");
  }
});

test("every non-transition holds the original snapshot", () => {
  for (const i of all()) {
    const o = r(i);
    if (o.action === "hold") { assert.equal(o.nextMode, i.currentMode); assert.equal(o.nextState, i.currentState); }
  }
  isHold({ requestedMode: "existing_direct", currentMode: "edge_pilot", currentState: "active", policyDecision: "allow", event: "policy_evaluated" }, "invalid_transition");
  isHold({ requestedMode: "existing_direct", currentMode: "existing_direct", currentState: "active", policyDecision: "allow", event: "policy_evaluated" }, "existing_direct_default");
  assert.deepEqual(r({ requestedMode: "existing_direct", currentMode: "none", currentState: "none", policyDecision: "allow", event: "policy_evaluated" }), { nextMode: "existing_direct", nextState: "active", action: "restore_direct", reasonCode: "existing_direct_default" });
});

test("module source is pure", () => {
  const s = readFileSync(join(import.meta.dirname, "../src/policy/assignment-lifecycle.ts"), "utf8");
  assert.doesNotMatch(s, /^\s*import\s/m);
  assert.doesNotMatch(s, /fusion|\\u|\\x/i);
  assert.doesNotMatch(s, /require\(|import\(|process\.|Date\b|Math\.random|randomUUID|fetch\(|setTimeout|setInterval|node:|fastify|redis|\bpg\b|readFile|writeFile|\.(get|post|put|patch|delete|route)\(/i);
});
