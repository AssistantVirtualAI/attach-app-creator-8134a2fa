# Lemtel Edge - Phase 5 PBX adapter threat model

Phase 5 only documents future requirements; no mitigation is live from this phase.

| Asset | Threat | Required future mitigation | Residual risk |
|---|---|---|---|
| Upstream credential | Upstream credential exfiltration | Server-side secret manager, in-memory handles, no logging | Compromised adapter host |
| Tenant isolation | Cross-tenant provisioning | Tenant binding check on every request | Binding misconfiguration |
| Extension state | Unauthorized extension state change | Control Plane authorization decision required | Insider with approval rights |
| Request integrity | Replayed provisioning request | Unique operation ref, nonce and timestamp window | Clock skew |
| Logs | PBX response/log leakage | Enumerated reason codes only, no raw responses | Upstream-side logging |
| Observed state | Stale observed state | Observation freshness enum and refresh | Delay before refresh |
| Revocation | Lost revocation | Revocation priority, retry and audit | Propagation delay |
| Service identity | Adapter/Edge impersonation | Mutual service authentication | Key compromise |
| Configuration | Configuration drift | Static verifiers and reviewed changes | Out-of-band edits |

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
