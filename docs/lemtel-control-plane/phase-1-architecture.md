# Lemtel Control Plane — Phase 1 architecture

```text
developer machine (loopback only)
  127.0.0.1:8081 ──> control-plane (Fastify, Node 22, non-root, read-only fs)
                        ├── postgres (dedicated Control Plane DB, no host port)
                        └── redis    (readiness PING only, no host port)
```

Routes: `GET /health/live`, `GET /health/ready`, `GET /v1/internal/status`, `POST /v1/internal/audit`.
Internal routes require `Authorization: Bearer <CONTROL_PLANE_SERVICE_TOKEN>` (server-to-server only, constant-time check, no CORS).

Phase 1 has **no Edge, no FusionPBX, no Supabase, no client traffic and no production deployment**.
The only writes are migration bookkeeping (`schema_migrations`) and `control_plane_audit_events` from the internal test route.

Future trust direction (not implemented): applications → Control Plane / Lemtel Edge; Edge → FusionPBX. Applications never talk to FusionPBX directly.
