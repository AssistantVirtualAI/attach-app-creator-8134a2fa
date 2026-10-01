# Lemtel Edge - credential reference lifecycle (future stages only)

1. Binding created: a server-side tenant / extension / device binding becomes active.
2. Capability issued: an opaque, short-lived capability reference is issued to the client.
3. Edge authorization evaluated: the future Edge requests an allow or deny decision with a fixed reason code.
4. In-memory credential handle resolved: the future Edge receives an opaque handle reference, held in memory only.
5. Handle expires: the handle and capability lapse at their expiry.
6. Revocation propagated: a device, capability or binding revocation notice reaches the future Edge.
7. Audit retained: decisions and revocations are kept as audit records without secret material.

Rules:

- Actual secret material may only be read by a future Edge server process from an approved server-side secret manager. It is never returned to a browser or app and never written to telemetry or logs.
- Maximum capability lifetime is 12 hours.
- Revocation takes priority over expiry: a revoked capability is refused even before it expires.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
