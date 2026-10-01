# Lemtel Control Plane — local development (macOS / Linux)

Generate your own local values. Put them only in the ignored file `infra/lemtel-control-plane/.env`. Never commit it, never paste it into chat or a ticket.

The Compose file is intentionally named `docker-compose.dev.yml`. Docker Compose does not load it automatically, so every Docker command below, run from `infra/lemtel-control-plane`, includes `-f docker-compose.dev.yml`.

Service only (unit tests, no Docker):

```sh
cd services/lemtel-control-plane
npm ci
npm run check
npm test
npm run build
```

Fail-closed check with the tracked `.env.example` (blank values), from `infra/lemtel-control-plane`:

```sh
cd infra/lemtel-control-plane
docker compose -f docker-compose.dev.yml --env-file .env.example config
docker compose -f docker-compose.dev.yml --env-file .env.example up --abort-on-container-exit --exit-code-from config-guard
docker compose -f docker-compose.dev.yml --env-file .env.example down -v --remove-orphans
```

- `config` succeeds and shows no secret value.
- `up` fails: `config-guard` reports only the missing setting names, so PostgreSQL, Redis and the Control Plane never start.

Create the local `.env` with freshly generated values:

```sh
test ! -e .env || { printf '%s\n' '.env already exists and was not changed.'; exit 1; }
umask 077
cp .env.example .env
printf 'CONTROL_PLANE_SERVICE_TOKEN=%s\nCONTROL_PLANE_DB_PASSWORD=%s\nCONTROL_PLANE_REDIS_PASSWORD=%s\nCONTROL_PLANE_LOG_LEVEL=info\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env
```

Run the local stack and smoke test:

```sh
docker compose -f docker-compose.dev.yml --env-file .env up -d --build
docker compose -f docker-compose.dev.yml --env-file .env exec control-plane node dist/src/migrations.js
docker compose -f docker-compose.dev.yml --env-file .env ps
curl -fsS http://127.0.0.1:8081/health/live
curl -fsS http://127.0.0.1:8081/health/ready
docker compose -f docker-compose.dev.yml --env-file .env down -v --remove-orphans
rm -f .env
```

Strong, developer-generated values belong only in the ignored `.env`. Never send a real secret to Lovable or chat, and never commit it.

Release validation (needs network access to the public npm advisory service):

```sh
cd services/lemtel-control-plane
npm audit --omit=dev --audit-level=high
cd ../..
node scripts/verify-lemtel-control-plane.mjs 6e512e962 --audit
```
