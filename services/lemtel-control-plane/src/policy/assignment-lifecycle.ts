// Phase 8 device-assignment lifecycle reducer. Pure deterministic policy library.
// Phase 10 imports it only through the non-executable authenticated evaluator. Output remains a proposal with no side effect.

export const ROUTING_MODES = ["existing_direct", "shadow_observe", "edge_pilot", "existing_direct_rollback"] as const;
export const ASSIGNMENT_STATES = ["pending", "active", "revoked", "expired"] as const;
export const LIFECYCLE_EVENTS = ["policy_evaluated", "activation_confirmed", "revocation_confirmed", "direct_restore_confirmed", "expiry_observed"] as const;
export const LIFECYCLE_ACTIONS = ["hold", "issue_pending", "activate", "request_revocation", "revoke", "restore_direct", "expire"] as const;
export const LIFECYCLE_REASONS = ["policy_denied", "existing_direct_default", "issued", "activated", "revocation_requested", "revoked", "direct_restored", "expired", "invalid_transition"] as const;

export type LifecycleRoutingMode = (typeof ROUTING_MODES)[number];
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];
export type LifecycleReason = (typeof LIFECYCLE_REASONS)[number];

export type AssignmentLifecycleInput = {
  readonly requestedMode: LifecycleRoutingMode;
  readonly currentMode: LifecycleRoutingMode | "none";
  readonly currentState: AssignmentState | "none";
  readonly policyDecision: "allow" | "deny";
  readonly event: LifecycleEvent;
};

export type AssignmentLifecycleResult = {
  readonly nextMode: LifecycleRoutingMode | "none";
  readonly nextState: AssignmentState | "none";
  readonly action: LifecycleAction;
  readonly reasonCode: LifecycleReason;
};

const hold = (input: AssignmentLifecycleInput, reasonCode: LifecycleReason): AssignmentLifecycleResult => ({ nextMode: input.currentMode, nextState: input.currentState, action: "hold", reasonCode });
const isFuture = (m: LifecycleRoutingMode | "none"): boolean => m === "edge_pilot" || m === "shadow_observe";
const isLive = (s: AssignmentState | "none"): boolean => s === "pending" || s === "active";

export function reduceAssignmentLifecycle(input: AssignmentLifecycleInput): AssignmentLifecycleResult {
  // Rule 1 — policy denial wins globally
  if (input.policyDecision === "deny") return hold(input, "policy_denied");
  // Rule 2 — expiry
  if (input.event === "expiry_observed") {
    if (isFuture(input.currentMode) && isLive(input.currentState)) return { nextMode: "none", nextState: "expired", action: "expire", reasonCode: "expired" };
    return hold(input, "invalid_transition");
  }
  // Rule 3 — direct restore
  if (input.event === "direct_restore_confirmed") {
    if (input.requestedMode === "existing_direct" && input.currentMode === "none" && input.currentState === "revoked") return { nextMode: "existing_direct", nextState: "active", action: "restore_direct", reasonCode: "direct_restored" };
    return hold(input, "invalid_transition");
  }
  // Rule 4 — revocation confirmation
  if (input.event === "revocation_confirmed") {
    if (input.requestedMode === "existing_direct_rollback" && input.currentMode === "edge_pilot" && isLive(input.currentState)) return { nextMode: "none", nextState: "revoked", action: "revoke", reasonCode: "revoked" };
    return hold(input, "invalid_transition");
  }
  // Rule 5 — activation
  if (input.event === "activation_confirmed") {
    if (input.requestedMode === input.currentMode && isFuture(input.requestedMode) && input.currentState === "pending") return { nextMode: input.requestedMode, nextState: "active", action: "activate", reasonCode: "activated" };
    return hold(input, "invalid_transition");
  }
  // Rule 6 — policy evaluation
  if (input.event === "policy_evaluated") {
    if (input.requestedMode === "existing_direct") {
      if (input.currentMode === "existing_direct" && input.currentState === "active") return hold(input, "existing_direct_default");
      if (input.currentMode === "none" && input.currentState === "none") return { nextMode: "existing_direct", nextState: "active", action: "restore_direct", reasonCode: "existing_direct_default" };
      return hold(input, "invalid_transition");
    }
    if (isFuture(input.requestedMode)) {
      if (input.currentMode === "none" && (input.currentState === "none" || input.currentState === "revoked" || input.currentState === "expired")) return { nextMode: input.requestedMode, nextState: "pending", action: "issue_pending", reasonCode: "issued" };
      return hold(input, "invalid_transition");
    }
    if (input.requestedMode === "existing_direct_rollback") {
      if (input.currentMode === "edge_pilot" && isLive(input.currentState)) return { nextMode: input.currentMode, nextState: input.currentState, action: "request_revocation", reasonCode: "revocation_requested" };
      return hold(input, "invalid_transition");
    }
  }
  return hold(input, "invalid_transition");
}
