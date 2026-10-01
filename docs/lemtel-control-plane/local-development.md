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

With the tracked `.env.example` (empty values), `docker compose up` refuses to start. This is intended.
