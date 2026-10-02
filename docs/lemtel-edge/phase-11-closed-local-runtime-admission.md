# Lemtel Edge — Phase 11: Closed Local Runtime Admission Package

Status: offline, static admission package only. Phase 11 starts nothing and makes no container image choice.

Nothing in this phase enables a PBX link, an Edge process, a server deployment, a client change or a route change. The published Lemtel clients stay on the existing direct route and the existing Lemtel portal remains the source of truth. All ten Phase 2 Edge feature gates remain literal `false`.

## Contracts

- Admission contract: `schemas/lemtel-edge/runtime/closed-local-edge-runtime-admission-v1.schema.json` — every field is a single fixed constant; `approvalState` is fixed to `not_approved`.
- Report contract: `schemas/lemtel-edge/runtime/closed-local-edge-runtime-report-v1.schema.json` — enum values only, with fixed `result` / `failureCode` relationships.

## Future Phase 12 admission criteria

1. A future container image must be verified as compatible with both Apple Silicon and Linux server CPU architectures before it is selected. Phase 11 selects no image.
2. A future local runtime must be explicitly loopback-only and default-deny. Any non-loopback binding must be rejected by the future test.
3. A future local validation may prove only a static `503` SIP response. It must never proxy, register, authenticate, forward or relay.
4. Media must remain unstarted. No RTPengine process may start in the future closed test.
5. No outgoing connection may be allowed to FusionPBX, the Control Plane, APNS, FCM, a DNS service, the public internet, any client application or any database.
6. A future test report may contain only the report schema fields — never raw logs or sensitive values.
7. All ten gates must remain false before, during and after the future test.
8. A mandatory cleanup plan must remove local containers, the local network, volumes and throwaway configuration. Cleanup has its own report state.
9. A separate written approval is required before Phase 12 is run. A separate later phase is required before any upstream or client integration.

## Out of scope

No container, Compose definition, listener, signalling, media, upstream, Control Plane event, push, recording, voicemail, client cutover, device migration, server deployment or pilot call is created or run by Phase 11.
