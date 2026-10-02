# Lemtel — Phase 14.0: Offline Staging Admission

Status: this is an offline admission package, not a deployment package. It is static data, schemas, a static verifier and a test only.

## What this phase does not do

No server command, container, port, DNS record, TLS certificate, PBX connection or app route may be changed by this phase. Nothing is started, configured, connected or deployed. All ten Lemtel Edge feature gates remain literal `false`.

## Current decision

The current admission remains denied. Six prerequisites are incomplete: fresh pre-change snapshot, monitoring owner, log retention, secrets owner, private DNS/TLS and PBX approval.

Already accepted prerequisites: hardened dedicated staging host, key-only access, SSH-only firewall, weekly provider backup, encrypted off-server backup and its non-sensitive restore test, and all Edge gates false. The encrypted off-server backup and its restore test are accepted prerequisites, but they do not make deployment permissible on their own.

## Contracts

- `schemas/lemtel-staging-admission/staging-admission-request-v1.schema.json` — fixed kind, opaque references, exactly 13 booleans.
- `schemas/lemtel-staging-admission/staging-admission-decision-v1.schema.json` — `denied` or `admitted`, fixed reason codes, every capability flag fixed to `false`.
- `schemas/lemtel-staging-admission/staging-admission-evidence-v1.schema.json` — evidence states `not_provided`, `verified` or `rejected` only.
- `schemas/lemtel-staging-admission/staging-admission-policy.json` — default and current decision `denied`.

`admitted` is invalid while any prerequisite is false. No code path executes an admission decision.

## Effect of a future admitted decision

A future admitted decision does not enable any service, route or Edge gate. Each later deployment or runtime phase needs separate written approval.

## Protected boundary

Existing Lemtel applications, the existing Lemtel portal, published apps, direct calling routes, FusionPBX integration and Planiprêt remain unchanged.
