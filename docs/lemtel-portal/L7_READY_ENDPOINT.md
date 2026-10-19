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

## DigitalOcean-only origin probe (arbiter)

Since the Load Balancer was put in front of `lemtel.assistantvirtualai.com`, that hostname can be steered to the
Hostinger pool. The first supervised drill showed the consequence: with DigitalOcean down, Cloudflare tried the
other origin and answered `522` only after ~20 s, past the arbiter's 8 s timeout, so every observation was
ambiguous and the arbiter (correctly) never fenced. Worse, a Load Balancer that steers a healthy writer's traffic
to Hostinger would make the public hostname a misleading witness of the DigitalOcean writer.

The arbiter therefore observes `https://lemtel-do-l7.assistantvirtualai.com/lemtel-lb-ready`:

- a **proxied** DNS record pointing at the DigitalOcean writer only (not a Load Balancer hostname);
- served by the DigitalOcean Caddy through a dedicated site block (`lemtel-ha-do-writer-origin-probe-site.sh`,
  markers `# LEMTEL_DO_ORIGIN_PROBE_V1` … `_END`, `tls internal`, Cloudflare SSL mode "full"), which returns the
  very same marker file and `404` for every other path;
- never staged on Hostinger: the Hostinger runtime refresh removes the block and refuses a probe host outside it.

Caddy stopped gives a fast `521`, droplet off gives `522`; both carry `cf-ray` and are definitive. The arbiter waits up
to 25 s for an L7 answer, and its serializer lease (50 s, still shorter than any observation cycle) is released
at the end of every tick and mailbox poll so the Hostinger agent is never starved.
