# Lemtel Edge - Phase 6 cutover threat model

Phase 6 documents requirements only and activates no mitigation, route or client change.

| Asset | Threat | Required future mitigation | Residual risk |
|---|---|---|---|
| Production routing | Accidental global cutover | Device-level assignments only, default existing_direct | Operator error |
| Device route | Dual registration / device route conflict | One active assignment per device, withdraw direct first | Stale client state |
| Rollback | Downgrade / rollback failure | Revoke Edge assignment before restore, verified rollback path | Client offline during rollback |
| Tenant isolation | Cross-tenant routing assignment | Tenant and extension scope checks | Binding misconfiguration |
| Pilot cohort | Unauthorized pilot enrollment | Recorded pilot approval and capability check | Insider with approval rights |
| Client releases | Unsafe client release / update | Separately reviewed per-platform release plan | Store review delays |
| Credentials | Credential exposure during client migration | Opaque references only, no credential transfer | Legacy client storage |
| Evidence | Evidence / data overcollection | Enumerated evidence only | Misuse of future logs |
| Decisions | Stale assignment / decision | Expiry and revocation states | Propagation delay |
| Feature gates | Feature-gate drift | Static verifiers keep all gates false | Out-of-band edits |

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
