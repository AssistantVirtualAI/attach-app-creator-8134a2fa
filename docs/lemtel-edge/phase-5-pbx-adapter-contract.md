# Lemtel Edge - Phase 5 PBX adapter contract (future)

Phase 5 is a specification only: schemas, documentation and static checks.

```mermaid
flowchart LR
  A[Client App] -->|future / disabled: opaque references only| C[Control Plane]
  C -->|future / disabled: provisioning request with opaque refs| P[PBX Adapter]
  P -->|future / disabled: enumerated result only| C
  A -->|future / disabled: signalling with capability reference| E[Lemtel Edge]
  E -->|future / disabled: private allowlisted route| F[FusionPBX]
  P -->|future / disabled: server-side least-privilege action| F
```

- Client traffic never reaches FusionPBX directly.
- The future Edge only reaches FusionPBX over a separately approved private/allowlisted route.
- Phase 5 creates no adapter, connection, tenant, extension, device, credential or PBX change.
- This contract works only with opaque refs and safe enumerated statuses. Schemas: `schemas/lemtel-edge/pbx/`.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
