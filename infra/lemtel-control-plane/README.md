# Lemtel Control Plane — local Compose (Phase 1)

Local development only. Services: `config-guard`, `control-plane`, `postgres`, `redis`.

This directory intentionally uses `docker-compose.dev.yml`, which Docker Compose does not load automatically. Every command must include `-f docker-compose.dev.yml`, for example `docker compose -f docker-compose.dev.yml --env-file .env ps`.

- The control plane is published on `127.0.0.1:8081` only. PostgreSQL and Redis have no host ports.
- Secrets come from an ignored local `.env` file in this folder. `.env.example` lists names only.
- With the empty example values, `docker compose up` refuses to start (fail closed). That is expected.
- No image is published and nothing is deployed. See `docs/lemtel-control-plane/local-development.md`.
- `config-guard` (pinned busybox, no network, non-root, read-only) runs first and checks the three local values without printing them. PostgreSQL, Redis and the control plane start only after it succeeds.
