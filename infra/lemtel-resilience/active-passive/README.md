# Lemtel — Hostinger primary / DigitalOcean warm standby

This package tracks the approved **availability-first** rollout for the Lemtel active–passive architecture. Hostinger is the only writer. DigitalOcean is a warm, read-only PostgreSQL standby over the private WireGuard path.

The owner selected **availability-first** on 2026-10-09. PostgreSQL commits on Hostinger must not wait for DigitalOcean. Replication lag will be measured and alerted, and no numeric RPO is promised until the controlled failover drill records actual recovery point and recovery time.

## Confirmed facts

- Restricted non-root administration access is verified on both Hostinger and DigitalOcean.
- Hostinger runs a self-hosted Supabase stack with PostgreSQL 17 and local Storage mounted in the Storage container.
- DigitalOcean runs only the PostgreSQL warm standby required for physical streaming replication. A Storage runtime and public application listener are not started there.
- Lemtel source artifacts already arrive with one immutable digest on both hosts. That delivery does not deploy or start a runtime.
- Cloudflare is selected as the Lemtel routing authority. The canonical hostname `lemtel.assistantvirtualai.com` is approved and confirmed unused by a read-only inventory; it has not been created in DNS and carries no traffic yet.
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

`lemtel-ha-primary-health-check.sh` and `lemtel-ha-primary-health-timer-enable.sh` add the separate primary-owned health monitor. It records local health status every two minutes with bounded jitter: WireGuard handshake, running primary containers, authenticated-route reachability without printing the endpoint, PostgreSQL writer state and streaming-replica lag, plus Storage timer/freshness. Each successful Storage sync atomically writes an attestation containing the latest manifest name and SHA-256; the health monitor validates that the manifest is still present and hash-matches the attestation. It writes local status and systemd journal evidence only; notification delivery remains separate until an alert destination is explicitly configured. It does not promote DO, change DNS, restart containers, expose a listener, or contact telephony.

`lemtel-ha-standby-failover-preflight.sh` and `CONTROLLED_FAILOVER_RUNBOOK.md` prepare the next safety gate. The script is root-only and read-only: it confirms recovery/WAL streaming, verifies that the standby still has no host/public PostgreSQL listener, and records whether the private primary database is reachable. It never invokes `pg_promote`, changes DNS, starts a Storage runtime, or treats loss of network reachability as proof that the primary has been fenced. The runbook requires separately approved fencing and a maintenance-window approval before any promotion action is even prepared.

`lemtel-ha-primary-alert-dispatch.sh` and `lemtel-ha-primary-alerts-enable.sh` add state-transition email notifications. The Hostinger dispatcher reads the local health state every two minutes with bounded jitter and sends only initial, degraded, or recovered transitions. It reuses the existing Resend secret inside the edge-runtime container rather than copying it into a file or repository; recipients are a root-only Hostinger file. The dispatcher does not change DNS, promote DO, open ports, start a standby runtime, or touch telephony.

`lemtel-ha-primary-standby-runtime-envelope-create.sh` and `lemtel-ha-standby-runtime-envelope-stage.sh` completed the deliberately inactive runtime stage. The primary encrypts only the active Compose configuration, `.env`, Edge Functions, and Caddy configuration to the exact standby `age` recipient. It never includes PostgreSQL or Storage data, which retain their independent replication paths. The standby decrypts the envelope root-only, validates the exact file allow-list and Compose syntax, and refuses if anything except the existing PostgreSQL standby is running. The runtime is staged but remains dormant: it never invokes `docker compose up`, starts a public listener, starts Storage, changes DNS, or promotes PostgreSQL.

`lemtel-ha-primary-canonical-caddy-prepare.sh` is the separate, root-only preparation for the approved canonical hostname. It generates a root-only candidate Caddyfile that keeps the existing proxy hostname and adds `lemtel.assistantvirtualai.com`, then parses that candidate inside the already-running Caddy image. It never replaces the mounted Caddyfile, reloads Caddy, restarts containers, calls Cloudflare, changes DNS, moves traffic, or contacts telephony.

`lemtel-ha-primary-canonical-caddy-apply.sh` is the explicitly gated live Caddy action. It accepts only the prevalidated candidate, re-derives it from the unchanged active Caddyfile, takes an exclusive lock, creates a root-only backup, validates the mounted file, and performs a Caddy hot reload. Any validation or reload failure restores the original file and attempts to reload it. It never creates DNS, changes client builds, starts a runtime or Storage, exposes PostgreSQL, promotes the standby, or contacts telephony. Its execution remains coordinated with a separately approved Cloudflare DNS action.

`lemtel-ha-primary-fence.sh` is the deliberate split-brain protection used immediately before a controlled standby promotion. It is root-only, token- and acknowledgement-gated, serializes access, records the original database-container restart policy in a root-only state file, sets `supabase-db` to no automatic restart, stops only that container, and proves no host PostgreSQL listener remains. Any failure while fencing restores the original restart policy and attempts to restart the primary database. It never promotes DO, changes DNS, starts the dormant standby runtime or Storage, or touches telephony. `lemtel-ha-primary-fence-abort-before-promotion.sh` is the only rollback path and is deliberately usable **only when no promotion and no DNS cutover occurred**; after a promotion, Hostinger must be rebuilt as a standby rather than restarted as a second writer.

`lemtel-ha-standby-postgres-promote.sh` is the separate, irreversible writer-promotion gate. It requires the matching root-only primary fence evidence, an incident identifier, a second explicit acknowledgement, active WireGuard, a healthy recovering WAL receiver, an unreachable primary database endpoint, and no host/public PostgreSQL listener. It then runs `pg_ctl promote` only for the existing standby database and records the promotion root-only. It never starts the dormant Supabase runtime, Storage, Caddy, DNS routing, former-primary restart, or telephony. A promoted DO database therefore remains private until a separate runtime and routing operation has been validated.

## Remaining controlled implementation

1. Create and validate the canonical Hostinger route on `lemtel.assistantvirtualai.com` without moving existing client traffic, then prove the matching dormant runtime path on DigitalOcean.
2. Execute the prepared primary fencing, standby promotion and documented failback drill in a maintenance window, once the canonical Cloudflare route can be changed. The standby will not auto-promote until fencing prevents split brain.

PostgreSQL documents streaming replication as asynchronous by default and recommends a dedicated replication account, `wal_level=replica`, adequate sender/slot settings, a base backup and a replication slot or WAL retention policy. [PostgreSQL warm standby](https://www.postgresql.org/docs/current/warm-standby.html)
Supabase documents database state and Storage objects as separate operational components, so Storage requires its own replication procedure. [Supabase self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

## Boundaries

- No Planiprêt data is queried, copied or used as a replication source.
- No FusionPBX, SIP, WSS, TURN, call routing or incoming-call configuration is changed.
- No public DigitalOcean application or database listener is enabled during preflight or tunnel creation.
- No automatic promotion, DNS switch or client cutover happens before fencing, health evidence and a documented drill.
- A call in progress cannot be guaranteed to survive primary loss. This architecture protects persisted Lemtel data and enables recovery for new requests after a controlled cutover.
