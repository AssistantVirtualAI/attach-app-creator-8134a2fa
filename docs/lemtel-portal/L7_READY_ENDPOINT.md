# Lemtel writer L7 readiness endpoint

`GET /lemtel-lb-ready` is a deliberately content-free endpoint for a future Cloudflare health monitor. It returns `200` with `ready` only when the local DigitalOcean writer checks all of the following:

- Caddy, PostgreSQL and Auth containers are running;
- PostgreSQL is the writer and has a streaming standby;
- WireGuard and the Storage timer are healthy;
- the recent Storage integrity attestation is within the local freshness policy; and
- the authenticated Auth health route is reachable.

Any failed check removes the marker, so Caddy returns a non-2xx response. The endpoint emits no topology, address, account, database, recording, credential or telephone information. It does not change DNS, Cloudflare routing, providers, promotion, fencing, runtime state or telephony.
