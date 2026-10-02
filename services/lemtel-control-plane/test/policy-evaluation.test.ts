import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuditStore, Pingable } from "../src/db.js";
import { app, TOKEN } from "./helpers.js";

const URL_PATH = "/v1/internal/policy/evaluate";
const AUTH = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

class Tripwire {
  hits = 0;
  pingable(): Pingable { return { ping: async () => { this.hits++; throw new Error("must not be used"); } }; }
  audit(): AuditStore { return { recordAudit: async () => { this.hits++; throw new Error("must not be used"); } }; }
}
const guarded = () => { const t = new Tripwire(); return { t, a: app({ db: t.pingable(), redis: t.pingable(), audit: t.audit() }) }; };

const CUTOVER_SPEC: Record<string, string[]> = {
  requestedMode: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  currentActiveMode: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback", "none"],
  phase1Runtime: ["pending", "passed"], edgeRuntime: ["disabled", "approved"], identityScope: ["denied", "authorized"],
  capability: ["invalid", "approved"], pilotApproval: ["missing", "recorded"], nonProductionApproval: ["missing", "approved"],
  directRoute: ["active", "withdrawn"], rollbackPath: ["unverified", "verified"],
};
const LIFECYCLE_SPEC: Record<string, string[]> = {
  requestedMode: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"],
  currentMode: ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback", "none"],
  currentState: ["pending", "active", "revoked", "expired", "none"], policyDecision: ["allow", "deny"],
  event: ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"],
};
const directCutover = { requestedMode: "existing_direct", currentActiveMode: "none", phase1Runtime: "pending", edgeRuntime: "disabled", identityScope: "denied", capability: "invalid", pilotApproval: "missing", nonProductionApproval: "missing", directRoute: "active", rollbackPath: "unverified" };
const approvedCutover = { requestedMode: "edge_pilot", currentActiveMode: "none", phase1Runtime: "passed", edgeRuntime: "approved", identityScope: "authorized", capability: "approved", pilotApproval: "recorded", nonProductionApproval: "approved", directRoute: "withdrawn", rollbackPath: "verified" };
const issueLifecycle = { requestedMode: "edge_pilot", currentMode: "none", currentState: "none", policyDecision: "allow", event: "policy_evaluated" };

const post = (a: ReturnType<typeof app>, payload: unknown, headers: Record<string, string> = AUTH) =>
  a.inject({ method: "POST", url: URL_PATH, headers, payload: typeof payload === "string" ? payload : JSON.stringify(payload) });

test("missing, malformed and wrong Bearer values are 401 and never evaluate", async () => {
  const { t, a } = guarded();
  for (const h of [undefined, "", "Bearer", "Basic abc", `bearer ${TOKEN}`, "Bearer short", `Bearer ${TOKEN}x`, `Bearer ${"Z".repeat(40)}`]) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (h !== undefined) headers.authorization = h;
    const r = await post(a, { kind: "cutover", input: approvedCutover }, headers);
    assert.equal(r.statusCode, 401); assert.deepEqual(r.json(), { error: "unauthorized" });
    assert.doesNotMatch(r.body, /non_executable|decision/);
  }
  assert.equal(t.hits, 0);
});

test("wrong or missing content type is 415", async () => {
  const a = app();
  for (const ct of [undefined, "text/plain", "application/xml", "application/jsonx"]) {
    const headers: Record<string, string> = { authorization: AUTH.authorization };
    if (ct) headers["content-type"] = ct;
    const r = await a.inject({ method: "POST", url: URL_PATH, headers, payload: JSON.stringify({ kind: "cutover", input: directCutover }) });
    assert.equal(r.statusCode, 415); assert.deepEqual(r.json(), { error: "unsupported_media_type" });
  }
});

test("null, array and non-object bodies are invalid_body", async () => {
  const a = app();
  for (const b of ["null", "[]", "1", '"x"', "true"]) {
    const r = await post(a, b);
    assert.equal(r.statusCode, 400); assert.deepEqual(r.json(), { error: "invalid_body" });
  }
});

test("unknown or missing top-level and nested fields are invalid_fields", async () => {
  const a = app();
  const { requestedMode: _omit, ...missing } = directCutover;
  for (const b of [{}, { kind: "cutover" }, { input: directCutover }, { kind: "cutover", input: directCutover, extra: "x" }, { kind: "cutover", input: null }, { kind: "cutover", input: [] },
    { kind: "cutover", input: { ...directCutover, extra: "x" } }, { kind: "cutover", input: missing }, { kind: "assignment_lifecycle", input: directCutover }]) {
    const r = await post(a, b);
    assert.equal(r.statusCode, 400, JSON.stringify(b)); assert.deepEqual(r.json(), { error: "invalid_fields" });
  }
});

test("invalid kind is invalid_kind", async () => {
  const a = app();
  for (const k of ["other", "", 1, null, "CUTOVER"]) {
    const r = await post(a, { kind: k, input: directCutover });
    assert.equal(r.statusCode, 400); assert.deepEqual(r.json(), { error: "invalid_kind" });
  }
});

test("every wrong type or value for every enum field is invalid_input", async () => {
  const a = app();
  const cases: [string, Record<string, string>, Record<string, string[]>][] = [["cutover", directCutover, CUTOVER_SPEC], ["assignment_lifecycle", issueLifecycle, LIFECYCLE_SPEC]];
  for (const [kind, base, spec] of cases) for (const field of Object.keys(spec)) for (const bad of [1, null, true, {}, [], "", "unknown_value", spec[field][0].toUpperCase()]) {
    const r = await post(a, { kind, input: { ...base, [field]: bad } });
    assert.equal(r.statusCode, 400, `${kind}.${field}`); assert.deepEqual(r.json(), { error: "invalid_input" });
    assert.doesNotMatch(r.body, /unknown_value/);
  }
});

test("valid direct cutover returns the exact non-executable shape", async () => {
  const r = await post(app(), { kind: "cutover", input: directCutover });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { kind: "cutover", execution: "non_executable", result: { decision: "allow", effectiveMode: "existing_direct", reasonCode: "existing_route_required" } });
});

test("approved future cutover returns only the pure calculation and touches no dependency", async () => {
  const { t, a } = guarded();
  const r = await post(a, { kind: "cutover", input: approvedCutover });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { kind: "cutover", execution: "non_executable", result: { decision: "allow", effectiveMode: "edge_pilot", reasonCode: "existing_route_required" } });
  assert.equal(t.hits, 0);
});

test("valid lifecycle returns the exact non-executable shape", async () => {
  const r = await post(app(), { kind: "assignment_lifecycle", input: issueLifecycle });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { kind: "assignment_lifecycle", execution: "non_executable", result: { nextMode: "edge_pilot", nextState: "pending", action: "issue_pending", reasonCode: "issued" } });
});

test("issue_pending and activate proposals perform no write, audit or task", async () => {
  const { t, a } = guarded();
  const r1 = await post(a, { kind: "assignment_lifecycle", input: issueLifecycle });
  const r2 = await post(a, { kind: "assignment_lifecycle", input: { requestedMode: "edge_pilot", currentMode: "edge_pilot", currentState: "pending", policyDecision: "allow", event: "activation_confirmed" } });
  assert.equal(r1.json().result.action, "issue_pending");
  assert.equal(r2.json().result.action, "activate");
  for (const r of [r1, r2]) { assert.equal(r.json().execution, "non_executable"); assert.equal("input" in r.json(), false); }
  assert.equal(t.hits, 0);
});

test("unknown routes stay generic 404", async () => {
  const r = await app().inject({ method: "POST", url: "/v1/internal/policy/other", headers: AUTH, payload: "{}" });
  assert.equal(r.statusCode, 404); assert.deepEqual(r.json(), { error: "not_found" });
  assert.doesNotMatch(r.body, /stack|at /);
});

test("security headers remain present", async () => {
  const r = await post(app(), { kind: "cutover", input: directCutover });
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.ok(r.headers["content-security-policy"]);
  assert.equal(r.headers["access-control-allow-origin"], undefined);
});

test("oversized body is generic 413 and does not evaluate", async () => {
  const { t, a } = guarded();
  const r = await post(a, JSON.stringify({ kind: "cutover", input: directCutover, pad: "x".repeat(5000) }));
  assert.equal(r.statusCode, 413); assert.deepEqual(r.json(), { error: "payload_too_large" });
  assert.equal(t.hits, 0);
});
