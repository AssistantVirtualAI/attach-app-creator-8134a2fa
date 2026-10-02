# Phase 10 — Authenticated, non-executable policy evaluation API

## Route

One internal route only: `POST /v1/internal/policy/evaluate`.

- Requires the existing service Bearer token on every request (otherwise `401 {"error":"unauthorized"}`).
- Requires `Content-Type: application/json` (otherwise `415 {"error":"unsupported_media_type"}`).
- Internal service-to-service use only. No CORS and no browser use.

## Request

A strict object with exactly two keys: `kind` and `input`.

- `kind: "cutover"` — `input` has exactly: `requestedMode`, `currentActiveMode`, `phase1Runtime`, `edgeRuntime`, `identityScope`, `capability`, `pilotApproval`, `nonProductionApproval`, `directRoute`, `rollbackPath`.
- `kind: "assignment_lifecycle"` — `input` has exactly: `requestedMode`, `currentMode`, `currentState`, `policyDecision`, `event`.

Every input field is an abstract enum string. No value identifies a person, organization, extension, device, endpoint or phone system.

Stable errors, never echoing request values: `invalid_body`, `invalid_fields`, `invalid_kind`, `invalid_input` (HTTP 400); oversized body `413 payload_too_large`.

## Response

Every successful response contains `"execution":"non_executable"` plus `kind` and a `result` from the pure Cutover Policy or Assignment Lifecycle reducer. Results such as `allow`, `issue_pending`, `activate`, `revoke`, `restore_direct` or `expire` are proposals only.

## Guarantees

- No persistence, no audit write, no queue or task, no device action, no routing change and no external call.
- The route imports only Fastify types, the existing service guard and the two pure policy modules.
- The Phase 1 local Docker runtime validation has passed on a local workstation; Phase 10 itself does not run Docker, and that result is not authorization to deploy or activate anything.
- All Edge gates remain false.
- No PBX, Edge, VPS, client cutover or pilot-call integration is enabled.
- Any future non-hypothetical integration requires a separate approved phase.
