// Phase 7 cutover policy. Pure deterministic policy library.
// Phase 10 imports it only through the non-executable authenticated evaluator. Output remains a proposal with no side effect.

export const ROUTING_MODES = ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"] as const;
export const REQUESTED_MODES = ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"] as const;
export const REASON_CODES = ["existing_route_required", "phase1_runtime_pending", "edge_disabled", "device_not_authorized", "capability_invalid", "pilot_not_approved", "prerequisites_incomplete", "rollback_required"] as const;
export const PILOT_PREREQUISITES = ["phase1_runtime_passed", "edge_runtime_approved", "upstream_nonproduction_approved", "device_capability_approved", "pilot_approval_recorded", "existing_route_withdrawn", "rollback_path_verified"] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];
export type ReasonCode = (typeof REASON_CODES)[number];

export type PolicyDecision = {
  readonly decision: "allow" | "deny";
  readonly effectiveMode: RoutingMode;
  readonly reasonCode: ReasonCode;
};

export type CutoverPolicyInput = {
  readonly requestedMode: RoutingMode;
  readonly currentActiveMode: RoutingMode | "none";
  readonly phase1Runtime: "pending" | "passed";
  readonly edgeRuntime: "disabled" | "approved";
  readonly identityScope: "denied" | "authorized";
  readonly capability: "invalid" | "approved";
  readonly pilotApproval: "missing" | "recorded";
  readonly nonProductionApproval: "missing" | "approved";
  readonly directRoute: "active" | "withdrawn";
  readonly rollbackPath: "unverified" | "verified";
};

const result = (decision: "allow" | "deny", effectiveMode: RoutingMode, reasonCode: ReasonCode): PolicyDecision => ({ decision, effectiveMode, reasonCode });

export function evaluateCutoverPolicy(input: CutoverPolicyInput): PolicyDecision {
  const mode = input.requestedMode;
  if (mode === "existing_direct") return result("allow", "existing_direct", "existing_route_required");
  if (mode === "existing_direct_rollback") {
    if (input.currentActiveMode !== "edge_pilot") return result("deny", "existing_direct", "rollback_required");
    if (input.rollbackPath !== "verified") return result("deny", "existing_direct", "rollback_required");
    return result("allow", "existing_direct", "existing_route_required");
  }
  if (input.phase1Runtime !== "passed") return result("deny", mode, "phase1_runtime_pending");
  if (input.edgeRuntime !== "approved") return result("deny", mode, "edge_disabled");
  if (input.identityScope !== "authorized") return result("deny", mode, "device_not_authorized");
  if (input.capability !== "approved") return result("deny", mode, "capability_invalid");
  if (input.pilotApproval !== "recorded") return result("deny", mode, "pilot_not_approved");
  if (input.nonProductionApproval !== "approved") return result("deny", mode, "prerequisites_incomplete");
  if (input.directRoute !== "withdrawn") return result("deny", mode, "existing_route_required");
  if (input.rollbackPath !== "verified") return result("deny", mode, "rollback_required");
  if (input.currentActiveMode !== "none") return result("deny", mode, "existing_route_required");
  return result("allow", mode, "existing_route_required");
}
