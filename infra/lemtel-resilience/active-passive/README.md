# Lemtel — Hostinger primary / DigitalOcean warm standby

This package tracks the approved **availability-first** foundation for the Lemtel active–passive architecture. Hostinger is the only writer. DigitalOcean will become a warm, read-only PostgreSQL standby after the preflight evidence is complete.

The owner selected **availability-first** on 2026-10-09. PostgreSQL commits on Hostinger must not wait for DigitalOcean. Replication lag will be measured and alerted, and no numeric RPO is promised until the controlled failover drill records actual recovery point and recovery time.

## Confirmed facts

- Restricted non-root administration access is verified on both Hostinger and DigitalOcean.
- Hostinger runs a self-hosted Supabase stack with PostgreSQL 17 and local Storage mounted in the Storage container.
- DigitalOcean is intentionally clean before standby provisioning. Docker, PostgreSQL, Storage and a public application listener are not yet started there.
- Lemtel source artifacts already arrive with one immutable digest on both hosts. That delivery does not deploy or start a runtime.
- Lemtel DNS uses an external `ui-dns` nameserver set. Its account/API access and health-routing capability are not yet verified.
- The two public server endpoints can reach each other over SSH. They do not share a private provider network, so the replication path must use an authenticated encrypted tunnel.

## Preflight evidence completed

The root-only read-only preflights confirmed that Hostinger has PostgreSQL 17.6, an unexposed database container and filesystem Storage. DigitalOcean has 2 vCPU, approximately 3.9 GiB memory and approximately 75 GiB free root storage, but no Docker, PostgreSQL, Storage, WireGuard service or public listener. The primary database data footprint is approximately 68 MiB and Storage approximately 1 MiB at the time of inventory. These measurements are sizing evidence, not an RPO or capacity guarantee.

## Private tunnel stage

The private host-to-host path uses WireGuard `lemtel-ha0` over UDP port `51820`, with the fixed point-to-point range `10.253.47.0/30`:

| Role | Tunnel address | Public database listener |
| --- | --- | --- |
| Hostinger primary | `10.253.47.1/30` | Not enabled |
| DigitalOcean standby | `10.253.47.2/30` | Not enabled |

`lemtel-ha-wireguard-key-init.sh` is the first, deliberately narrow mutation. It installs only `wireguard-tools` when missing and generates a root-readable local keypair at `/etc/lemtel-ha/wireguard/`. It does **not** start an interface, open a firewall port, add a route, change DNS, touch PostgreSQL/Storage, or contact FusionPBX/SIP. It emits only the corresponding WireGuard public key.

After both public keys are verified, `lemtel-ha-wireguard-configure.sh` writes a one-time interface configuration, starts `wg-quick@lemtel-ha0`, and adds a UFW rule restricted to the peer’s public IPv4 address **only when UFW is active**. The script refuses to overwrite an active interface or pre-existing configuration. It does not bind PostgreSQL, configure Docker, copy Storage, transfer runtime secrets, change DNS, promote the standby, or alter telephony.

`lemtel-ha-standby-docker-bootstrap.sh` is the next isolated stage for a clean DigitalOcean host. It installs Docker plus its Compose plugin only if absent, starts the Docker daemon, prepares root-only standby directories, and pulls the exact PostgreSQL 17 Supabase image already verified on Hostinger. It refuses to run if any container already exists. It does **not** create a database, restore a base backup, run Supabase, publish a port, copy Storage, transfer a secret, configure DNS, or touch telephony.

## Controlled implementation after private connectivity

1. Bind PostgreSQL only to the Hostinger WireGuard address, never to a public interface. This step requires a planned short database-container recreation and separate confirmation immediately before execution.
2. Install matching PostgreSQL 17 images on DigitalOcean and bind the standby only to the private path.
3. Add a dedicated `LOGIN REPLICATION` role, a physical replication slot and a `pg_hba.conf` rule limited to the private standby address. The role password is created and transferred through root-only files; it is never committed, echoed or copied through GitHub artifacts.
4. Create the standby using `pg_basebackup`, `standby.signal` and `primary_conninfo`. Confirm `pg_stat_replication`, `pg_stat_wal_receiver`, replay lag and WAL-retention bounds.
5. Configure checksum-verified Storage replication according to the confirmed filesystem backend. PostgreSQL volume copying is prohibited because it is not a safe replication mechanism.
6. Deploy the same immutable Lemtel artifact and separately managed encrypted runtime configuration to the standby. Plaintext `.env` files and private keys are never replicated.
7. Add persistent health checks, replication/storage integrity alerts, fencing and an explicit promotion/failback runbook.
8. Configure controlled external routing only after private readiness and a maintenance-window drill have passed. The standby will not auto-promote until fencing prevents split brain.

PostgreSQL documents streaming replication as asynchronous by default and recommends a dedicated replication account, `wal_level=replica`, adequate sender/slot settings, a base backup and a replication slot or WAL retention policy. [PostgreSQL warm standby](https://www.postgresql.org/docs/current/warm-standby.html)
Supabase documents database state and Storage objects as separate operational components, so Storage requires its own replication procedure. [Supabase self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

## Boundaries

- No Planiprêt data is queried, copied or used as a replication source.
- No FusionPBX, SIP, WSS, TURN, call routing or incoming-call configuration is changed.
- No public DigitalOcean application or database listener is enabled during preflight or tunnel creation.
- No automatic promotion, DNS switch or client cutover happens before fencing, health evidence and a documented drill.
- A call in progress cannot be guaranteed to survive primary loss. This architecture protects persisted Lemtel data and enables recovery for new requests after a controlled cutover.
