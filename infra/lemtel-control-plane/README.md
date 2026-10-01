# Lemtel Control Plane — local Compose (Phase 1)

Local development only. Three services: `control-plane`, `postgres`, `redis`.

- The control plane is published on `127.0.0.1:8081` only. PostgreSQL and Redis have no host ports.
- Secrets come from an ignored local `.env` file in this folder. `.env.example` lists names only.
- With the empty example values, `docker compose up` refuses to start (fail closed). That is expected.
- No image is published and nothing is deployed. See `docs/lemtel-control-plane/local-development.md`.
