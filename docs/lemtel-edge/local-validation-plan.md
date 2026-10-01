# Lemtel Edge - local validation plan

No Docker command is to be run in Phase 2.

## Static checks runnable now

- `node scripts/verify-lemtel-edge-phase2.mjs <baseRef>`
- `npx vitest run src/test/lemtelEdgePhase2.test.ts`

## Deferred until Docker is available

- Phase 1 Docker runtime gate: the full sequence in `docs/lemtel-control-plane/local-development.md`. Pending.

## Later Edge validation milestones (each a separately approved step)

1. Configuration parse
2. Closed default SIP response (static 503)
3. No external listener
4. No FusionPBX egress
5. No Control Plane event emission
6. Separately approved test-tenant pilot

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It must pass before any Edge container, deployment, FusionPBX integration, client cutover or pilot call.
