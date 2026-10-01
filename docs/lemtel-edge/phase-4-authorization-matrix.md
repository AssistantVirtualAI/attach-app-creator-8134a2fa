# Lemtel Edge - Phase 4 authorization matrix (future)

| Future actor | Allowed future input | Allowed future output | Forbidden output | Audit expectation |
|---|---|---|---|---|
| Client App | Opaque capability reference and status | Signalling to the future Edge carrying the capability reference | Raw SIP/PBX secret, FusionPBX host, Edge secret, private key, administrative control | Capability issue and revocation audited |
| Control Plane | Binding records, Edge resolution requests | Capability references, authorization decisions, in-memory handle references to the Edge only | Raw secret material to clients or logs | Every decision and revocation audited |
| Lemtel Edge | Capability references, resolution results, revocation notices | Allowlisted traffic to FusionPBX | Secret material to clients, telemetry or logs | Every resolution audited by reference |
| FusionPBX | Traffic from the future Edge only, never direct client traffic | Responses to the future Edge only | Any direct exchange with client apps | Edge-originated traffic only |

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
