# Lemtel writer L7 readiness endpoint

`GET /lemtel-lb-ready` is a deliberately minimal, non-sensitive endpoint for a future Cloudflare health monitor and the prepared failover arbiter. When the local DigitalOcean writer passes every check below, Caddy returns `200`, `Content-Type: application/json` and exactly one JSON object with these five fields:

```json
{"format":"lemtel_do_writer_l7_ready_v1","writer_role":"do_writer","definitive":true,"observed_at":1700000000,"status":"healthy"}
```

`observed_at` is the writer's current Unix epoch in seconds. The example value is illustrative only. The marker contains no topology, address, account, client, database, recording, credential or telephone data.

The marker is written only when the local DigitalOcean writer checks all of the following:

- Caddy, PostgreSQL and Auth containers are running;
- PostgreSQL is the writer (not in recovery); and
- the authenticated Auth health route is reachable.

The marker deliberately measures **only the writer itself**. Standby-side signals (WireGuard tunnel, streaming replica, Storage copy) are not part of it: a missing marker means "the writer is down" to the arbiter and to the Cloudflare monitor, so a Hostinger or tunnel outage must never make a healthy writer look dead. Standby readiness reaches the arbiter separately, signed by the Hostinger agent.

Any failed check removes the marker. On this exact path, Caddy consequently returns `404`. The failover arbiter treats as definitive only this `404`, or a Cloudflare edge `521`/`522`/`523` (origin down or unreachable) carrying a `cf-ray` header, each from the configured host and exact path. A timeout, transport error, redirect, unexpected host or path, any other `5xx` (including `520`/`524`), a `200` with a non-JSON/stale/non-exact marker, or any other response is **ambiguous** and cannot contribute to fencing.

The endpoint does not change DNS, Cloudflare routing, providers, promotion, fencing, runtime state or telephony.
