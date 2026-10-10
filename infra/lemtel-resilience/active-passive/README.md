# Lemtel — Hostinger primary / DigitalOcean warm standby

This package tracks the approved **availability-first** rollout for the Lemtel active–passive architecture. Hostinger is the only writer. DigitalOcean is a warm, read-only PostgreSQL standby over the private WireGuard path.

The owner selected **availability-first** on 2026-10-09. PostgreSQL commits on Hostinger must not wait for DigitalOcean. Replication lag will be measured and alerted, and no numeric RPO is promised until the controlled failover drill records actual recovery point and recovery time.

## Confirmed facts

- Restricted non-root administration access is verified on both Hostinger and DigitalOcean.
- Hostinger runs a self-hosted Supabase stack with PostgreSQL 17 and local Storage mounted in the Storage container.
- DigitalOcean runs only the PostgreSQL warm standby required for physical streaming replication. A Storage runtime and public application listener are not started there.
- Lemtel source artifacts already arrive with one immutable digest on both hosts. That delivery does not deploy or start a runtime.
- Lemtel DNS uses an external `ui-dns` nameserver set. Its account/API access and health-routing capability are not yet verified.
- The two public server endpoints can reach each other over SSH. They do not share a private provider network, so the replication path must use an authenticated encrypted tunnel.

## Preflight evidence completed

The root-only read-only preflights confirmed that Hostinger has PostgreSQL 17.6, an unexposed database container and filesystem Storage. DigitalOcean has 2 vCPU, approximately 3.9 GiB memory and approximately 75 GiB free root storage, but no Docker, PostgreSQL, Storage, WireGuard service or public listener. The primary database data footprint is approximately 68 MiB and Storage approximately 1 MiB at the time of inventory. These measurements are sizing evidence, not an RPO or capacity guarantee.

## Private tunnel stage

The private host-to-host path uses WireGuard `lemtel-ha0` over UDP port `51820`, with the fixed point-to-point range `10.253.47.0/30`:

| Role                 | Tunnel address   | Public database listener |
| -------------------- | ---------------- | ------------------------ |
| Hostinger primary    | `10.253.47.1/30` | Not enabled              |
| DigitalOcean standby | `10.253.47.2/30` | Not enabled              |

`lemtel-ha-wireguard-key-init.sh` is the first, deliberately narrow mutation. It installs only `wireguard-tools` when missing and generates a root-readable local keypair at `/etc/lemtel-ha/wireguard/`. It does **not** start an interface, open a firewall port, add a route, change DNS, touch PostgreSQL/Storage, or contact FusionPBX/SIP. It emits only the corresponding WireGuard public key.

After both public keys are verified, `lemtel-ha-wireguard-configure.sh` writes a one-time interface configuration, starts `wg-quick@lemtel-ha0`, and adds a UFW rule restricted to the peer’s public IPv4 address **only when UFW is active**. The script refuses to overwrite an active interface or pre-existing configuration. It does not bind PostgreSQL, configure Docker, copy Storage, transfer runtime secrets, change DNS, promote the standby, or alter telephony.

`lemtel-ha-standby-docker-bootstrap.sh` is the next isolated stage for a clean DigitalOcean host. It installs Docker plus its Compose plugin and the local `age` tool only if absent, starts the Docker daemon, prepares root-only standby directories, creates one root-readable local encryption identity, and pulls the exact PostgreSQL 17 Supabase image already verified on Hostinger. It emits only the matching public `age` recipient. It refuses to run if any container already exists. It does **not** create a database, restore a base backup, run Supabase, publish a port, copy Storage, transfer a secret, configure DNS, or touch telephony.

`lemtel-ha-primary-postgres-streaming-prepare.sh` and `lemtel-ha-standby-postgres-basebackup.sh` are the controlled PostgreSQL stage. They are root-only and each requires an explicit, different execution token. The primary script verifies the WireGuard handshake, requires the exact PostgreSQL 17.6 Supabase image, adds a `pg_hba.conf` rule for the standby tunnel address only, creates a dedicated physical replication slot, and recreates only the database container with `5432` bound to `10.253.47.1` (the private WireGuard address). It creates the replication credential locally on Hostinger and encrypts one envelope to the DigitalOcean local `age` recipient; the credential is never printed or committed. The standby script can run only after the clean-host bootstrap and private envelope delivery; it initializes an empty, read-only PostgreSQL standby via `pg_basebackup`, never publishes `5432`, and verifies recovery plus the WAL receiver. PostgreSQL streaming is now verified: the primary reports one active asynchronous streaming replica and the standby reports a WAL receiver in `streaming`. `lemtel-ha-standby-postgres-recovery-remediate.sh` is the separate root-only recovery path for an already initialized replica; it sets `hot_standby=on` only on that replica and stops it automatically if recovery or WAL streaming validation fails.

`lemtel-ha-storage-primary-key-init.sh`, `lemtel-ha-storage-standby-receiver-bootstrap.sh`, `lemtel-ha-storage-standby-receiver-shell-remediate.sh`, and `lemtel-ha-storage-primary-sync.sh` prepare the separate filesystem Storage stage. They require the confirmed filesystem backend, pin the standby SSH host key, use a dedicated receiver restricted to the Hostinger WireGuard address, lock each one-way sync, checksum transferred contents, write a manifest, and deliberately retain source deletions on the standby. The receiver has a minimal shell only because OpenSSH launches the forced `rsync` command through it; its single authorized key is source-pinned, `restrict`ed and bound to a fixed receiver command, so interactive access remains unavailable. `lemtel-ha-storage-primary-timer-enable.sh` is the later root-only activation step after the initial sync is proven: it installs a Hostinger-owned timer with a five-minute cadence plus bounded jitter. It never starts Storage on DigitalOcean, transfers runtime secrets, publishes a listener, enables deletion propagation, or configures promotion.

## Remaining controlled implementation

1. Bootstrap the restricted Storage receiver on DigitalOcean, initialize the dedicated Hostinger key and prove one checksum-verified, one-way initial filesystem sync. PostgreSQL volume copying is prohibited because it is not a safe replication mechanism.
2. Activate and observe the host-owned timer, then add retention-safe Storage freshness/integrity evidence. Plaintext `.env` files and private keys are never replicated.
3. Add persistent health checks, replication/storage integrity alerts, fencing and an explicit promotion/failback runbook.
4. Configure controlled external routing only after private readiness and a maintenance-window drill have passed. The standby will not auto-promote until fencing prevents split brain.

PostgreSQL documents streaming replication as asynchronous by default and recommends a dedicated replication account, `wal_level=replica`, adequate sender/slot settings, a base backup and a replication slot or WAL retention policy. [PostgreSQL warm standby](https://www.postgresql.org/docs/current/warm-standby.html)
Supabase documents database state and Storage objects as separate operational components, so Storage requires its own replication procedure. [Supabase self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

## Boundaries

- No Planiprêt data is queried, copied or used as a replication source.
- No FusionPBX, SIP, WSS, TURN, call routing or incoming-call configuration is changed.
- No public DigitalOcean application or database listener is enabled during preflight or tunnel creation.
- No automatic promotion, DNS switch or client cutover happens before fencing, health evidence and a documented drill.
- A call in progress cannot be guaranteed to survive primary loss. This architecture protects persisted Lemtel data and enables recovery for new requests after a controlled cutover.
