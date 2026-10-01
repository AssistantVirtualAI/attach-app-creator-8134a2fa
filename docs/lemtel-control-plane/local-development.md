# Lemtel Control Plane — local development (macOS / Linux)

Generate your own local values. Put them only in the ignored file `infra/lemtel-control-plane/.env`. Never commit it, never paste it into chat or a ticket.

Service only (unit tests, no Docker):

```sh
cd services/lemtel-control-plane
npm ci
npm run check
npm test
npm run build
```

Create the local `.env` with freshly generated values:

```sh
cd infra/lemtel-control-plane
cp .env.example .env
printf 'CONTROL_PLANE_SERVICE_TOKEN=%s\nCONTROL_PLANE_DB_PASSWORD=%s\nCONTROL_PLANE_REDIS_PASSWORD=%s\nCONTROL_PLANE_LOG_LEVEL=info\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env
```

Run the local stack and smoke test:

```sh
docker compose --env-file .env up -d --build
docker compose --env-file .env exec control-plane node dist/src/migrations.js
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:8081/health/live
curl -fsS http://127.0.0.1:8081/health/ready
docker compose --env-file .env down -v
```

Expected behavior with the tracked `.env.example` (blank values):

```sh
docker compose -f infra/lemtel-control-plane/docker-compose.dev.yml --env-file infra/lemtel-control-plane/.env.example config
cd infra/lemtel-control-plane
docker compose --env-file .env.example up --abort-on-container-exit --exit-code-from config-guard
```

- `config` succeeds and shows no secret value.
- `up` fails: `config-guard` rejects the missing values, so PostgreSQL, Redis and the Control Plane never start.

Strong, developer-generated values belong only in the ignored `.env`. Never send a real secret to Lovable or chat, and never commit it.

Release validation (needs network access to the public npm advisory service):

```sh
cd services/lemtel-control-plane
npm audit --omit=dev --audit-level=high
cd ../..
node scripts/verify-lemtel-control-plane.mjs 6e512e962 --audit
```
