import type { FastifyInstance } from "fastify";
import { makeServiceGuard } from "../auth.js";
import { evaluateCutoverPolicy, type CutoverPolicyInput } from "../policy/cutover.js";
import { reduceAssignmentLifecycle, type AssignmentLifecycleInput } from "../policy/assignment-lifecycle.js";

// Phase 10: authenticated, non-executable evaluator. Pure calculation only:
// no persistence, no queue, no outbound request, no state change.

const MODES = ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"] as const;

const CUTOVER_FIELDS: Record<string, readonly string[]> = {
  requestedMode: MODES,
  currentActiveMode: [...MODES, "none"],
  phase1Runtime: ["pending", "passed"],
  edgeRuntime: ["disabled", "approved"],
  identityScope: ["denied", "authorized"],
  capability: ["invalid", "approved"],
  pilotApproval: ["missing", "recorded"],
  nonProductionApproval: ["missing", "approved"],
  directRoute: ["active", "withdrawn"],
  rollbackPath: ["unverified", "verified"],
};

const LIFECYCLE_FIELDS: Record<string, readonly string[]> = {
  requestedMode: MODES,
  currentMode: [...MODES, "none"],
  currentState: ["pending", "active", "revoked", "expired", "none"],
  policyDecision: ["allow", "deny"],
  event: ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => k.includes(x));
};

export async function policyEvaluationRoutes(app: FastifyInstance, deps: { token: string }) {
  app.addHook("onRequest", makeServiceGuard(deps.token));

  app.post("/v1/internal/policy/evaluate", async (req, reply) => {
    const ct = String(req.headers["content-type"] ?? "");
    if (!/^application\/json(\s*;.*)?$/i.test(ct)) return reply.code(415).send({ error: "unsupported_media_type" });
    const b = req.body;
    if (!isObj(b)) return reply.code(400).send({ error: "invalid_body" });
    if (!sameKeys(b, ["kind", "input"]) || !isObj(b.input)) return reply.code(400).send({ error: "invalid_fields" });
    if (b.kind !== "cutover" && b.kind !== "assignment_lifecycle") return reply.code(400).send({ error: "invalid_kind" });
    const spec = b.kind === "cutover" ? CUTOVER_FIELDS : LIFECYCLE_FIELDS;
    const input = b.input;
    if (!sameKeys(input, Object.keys(spec))) return reply.code(400).send({ error: "invalid_fields" });
    for (const [k, allowed] of Object.entries(spec)) {
      const v = input[k];
      if (typeof v !== "string" || !allowed.includes(v)) return reply.code(400).send({ error: "invalid_input" });
    }
    if (b.kind === "cutover") {
      const r = evaluateCutoverPolicy(input as unknown as CutoverPolicyInput);
      return { kind: "cutover", execution: "non_executable", result: { decision: r.decision, effectiveMode: r.effectiveMode, reasonCode: r.reasonCode } };
    }
    const r = reduceAssignmentLifecycle(input as unknown as AssignmentLifecycleInput);
    return { kind: "assignment_lifecycle", execution: "non_executable", result: { nextMode: r.nextMode, nextState: r.nextState, action: r.action, reasonCode: r.reasonCode } };
  });
}
