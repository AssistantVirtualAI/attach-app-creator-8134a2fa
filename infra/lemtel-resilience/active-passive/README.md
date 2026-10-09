# Lemtel — Hostinger primary / DigitalOcean warm standby

This package tracks the approved **availability-first** foundation for the Lemtel active–passive architecture. Hostinger is the only writer. DigitalOcean will become a warm, read-only PostgreSQL standby after the preflight evidence is complete.

The owner selected **availability-first** on 2026-10-09. PostgreSQL commits on Hostinger must not wait for DigitalOcean. Replication lag will be measured and alerted, and no numeric RPO is promised until the controlled failover drill records actual recovery point and recovery time.

## Confirmed facts

- Restricted non-root administration access is verified on both Hostinger and DigitalOcean.
- Hostinger runs a self-hosted Supabase stack with PostgreSQL 17 and local Storage mounted in the Storage container.
- DigitalOcean is intentionally clean before standby provisioning. Docker, PostgreSQL, Storage and a public application listener are not yet started there.
- Lemtel source artifacts already arrive with one immutable digest on both hosts. That delivery does not deploy or start a runtime.
- Lemtel DNS uses an external `ui-dns` nameserver set. Its account/API access and health-routing capability are not yet verified.

## Preflight evidence required now

Run the two root-only **read-only** scripts. They do not install packages, create users, start containers, copy secrets, change DNS, modify firewall rules, or contact FusionPBX/SIP.

```bash
# Hostinger primary
LEMTEL_HA_ROLE=hostinger_primary \
LEMTEL_DB_CONTAINER=supabase-db \
LEMTEL_STORAGE_CONTAINER=supabase-storage \
bash lemtel-ha-primary-replication-inventory.sh

# DigitalOcean standby
LEMTEL_HA_ROLE=digitalocean_standby \
bash lemtel-ha-standby-preflight.sh
```

The primary inventory identifies the actual PostgreSQL files, runtime settings, container mount sources, published database ports, active replication slots and the Storage backend class without printing passwords, JWTs, API keys or other credentials. The standby preflight records disk, memory, existing listeners and required tools without changing them.

## Controlled implementation after preflight

1. Build a private encrypted host-to-host path. PostgreSQL port 5432 remains unavailable to the public internet.
2. Install matching PostgreSQL 17 images on DigitalOcean and bind the standby only to the private path.
3. Add a dedicated `LOGIN REPLICATION` role, a physical replication slot and a `pg_hba.conf` rule limited to the private standby address. The role password is created and transferred through root-only files; it is never committed, echoed or copied through GitHub artifacts.
4. Create the standby using `pg_basebackup`, `standby.signal` and `primary_conninfo`. Confirm `pg_stat_replication`, `pg_stat_wal_receiver`, replay lag and WAL-retention bounds.
5. Configure checksum-verified Storage replication according to the confirmed backend. PostgreSQL volume copying is prohibited because it is not a safe replication mechanism.
6. Deploy the same immutable Lemtel artifact and separately managed encrypted runtime configuration to the standby. Plaintext `.env` files and private keys are never replicated.
7. Add persistent health checks, replication/storage integrity alerts, fencing and an explicit promotion/failback runbook.
8. Configure controlled external routing only after private readiness and a maintenance-window drill have passed. The standby will not auto-promote until fencing prevents split brain.

PostgreSQL documents streaming replication as asynchronous by default and recommends a dedicated replication account, `wal_level=replica`, adequate sender/slot settings, a base backup and a replication slot or WAL retention policy. [PostgreSQL warm standby](https://www.postgresql.org/docs/current/warm-standby.html)
Supabase documents database state and Storage objects as separate operational components, so Storage requires its own replication procedure. [Supabase self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

## Boundaries

- No Planiprêt data is queried, copied or used as a replication source.
- No FusionPBX, SIP, WSS, TURN, call routing or incoming-call configuration is changed.
- No public DigitalOcean application or database listener is enabled during preflight.
- No automatic promotion, DNS switch or client cutover happens before fencing, health evidence and a documented drill.
- A call in progress cannot be guaranteed to survive primary loss. This architecture protects persisted Lemtel data and enables recovery for new requests after a controlled cutover.
