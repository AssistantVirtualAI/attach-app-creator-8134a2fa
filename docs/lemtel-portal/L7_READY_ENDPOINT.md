# Lemtel writer L7 readiness endpoint

`GET /lemtel-lb-ready` is a deliberately minimal, non-sensitive endpoint for a future Cloudflare health monitor and the prepared failover arbiter. When the local DigitalOcean writer passes every check below, Caddy returns `200`, `Content-Type: application/json` and exactly one JSON object with these five fields:

```json
{"format":"lemtel_do_writer_l7_ready_v1","writer_role":"do_writer","definitive":true,"observed_at":1700000000,"status":"healthy"}
```

`observed_at` is the writer's current Unix epoch in seconds. The example value is illustrative only. The marker contains no topology, address, account, client, database, recording, credential or telephone data.

The marker is written only when the local DigitalOcean writer checks all of the following:

- Caddy, PostgreSQL and Auth containers are running;
- PostgreSQL is the writer and has a streaming standby;
- WireGuard and the Storage timer are healthy;
- the recent Storage integrity attestation is within the local freshness policy; and
- the authenticated Auth health route is reachable.

Any failed check removes the marker. On this exact path, Caddy consequently returns `404`; this is the only negative observation the failover arbiter may treat as definitive, and only after a clear HTTPS response from the configured host and exact path. A timeout, transport error, redirect, unexpected host or path, arbitrary `5xx`, a `200` with a non-JSON/stale/non-exact marker, or any other response is **ambiguous** and cannot contribute to fencing.

The endpoint does not change DNS, Cloudflare routing, providers, promotion, fencing, runtime state or telephony.
