# Lemtel — Hostinger primary / DigitalOcean warm standby

This package implements the **controlled foundation** for the approved Lemtel active–passive architecture. It does not start a service, expose a database, change DNS, copy a secret, activate FusionPBX/SIP, or change an installed client.

## Target state

Hostinger remains the only writer. DigitalOcean is a warm, read-only PostgreSQL standby and receives the same immutable Lemtel release artifact. A health-checked external routing provider may direct traffic to DigitalOcean only after its private readiness, fencing, replication lag, storage integrity, and failover drill evidence are verified.

The database replication mechanism is PostgreSQL physical streaming replication using a dedicated `LOGIN REPLICATION` account, a physical replication slot, `standby.signal`, and `primary_conninfo`. The database listener must be reachable only over a private encrypted path between the two hosts; it must never be opened to the public internet. PostgreSQL's official guidance requires `wal_level=replica`, sufficient `max_wal_senders` and `max_replication_slots`, trusted replication authentication, and a base backup to initialize the standby. [PostgreSQL warm standby](https://www.postgresql.org/docs/current/warm-standby.html)

Physical replication carries Lemtel database state, including Auth records and storage metadata. It does **not** copy storage objects or Edge Functions by itself. Supabase documents those as separate operational components, so the storage backend must be inventoried before choosing the correct replication mechanism. [Supabase self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

## Required facts before a live configuration

Run the redacted inventory on each host. It prints only container names, image names, states, mount destinations, and environment-variable names. It never prints secret values or connects to telephony.

```bash
LEMTEL_HA_ROLE=primary \
LEMTEL_DB_CONTAINER=<actual-postgres-container> \
LEMTEL_STORAGE_CONTAINER=<actual-storage-container> \
bash lemtel-ha-inventory.sh
```

The matching DigitalOcean command uses `LEMTEL_HA_ROLE=standby`. The actual output is required to verify the PostgreSQL major version, image compatibility, storage backend, correct data directories, and which configuration files are safe to modify.

Before any write, the rollout needs a working restricted administrator identity for both hosts, the actual storage backend, a routing provider that supports health checks, and the owner’s choice for the acknowledgement policy:

- **Availability-first**: asynchronous streaming replication with measured replication-lag alerts. This keeps Hostinger writable when the standby is unavailable, but the accepted recovery point objective must be defined.
- **Durability-first**: synchronous acknowledgement from the standby. This minimizes data loss for acknowledged writes, but Hostinger can block writes while DigitalOcean is unavailable.

No default is assumed because that choice changes production behavior.

## Required implementation sequence

1. Verify two non-root, restricted administration identities and the exact current Docker/Supabase inventory.
2. Build a private encrypted host-to-host replication path; PostgreSQL port 5432 remains unavailable to the public internet.
3. Match PostgreSQL major versions and image digests. Configure WAL, replication role, `pg_hba.conf`, replication slot, and a base backup only from the actual inventory.
4. Configure the DigitalOcean database with `standby.signal`, `primary_conninfo`, and the primary slot. Confirm `pg_stat_replication`, `pg_stat_wal_receiver`, replay lag, and disk/WAL retention monitoring.
5. Configure storage-object replication based on the discovered backend. The process must provide versioning, checksums, retry behavior, and an integrity alert; copying PostgreSQL volumes is prohibited.
6. Install the same immutable application artifact and separately managed encrypted secrets on both hosts. Plaintext `.env` files and private keys are never replicated.
7. Add private readiness checks, fencing, alerting, and a documented failback path. The standby cannot automatically promote unless fencing proves the Hostinger writer is inactive.
8. Configure external active–passive health-checked routing only after both private endpoints are healthy. The DNS/routing provider has not yet been identified in the current environment.
9. Run a scheduled maintenance-window failover drill, capture recovery point/time measurements, validate Auth, storage and Lemtel-only application paths, then test failback.

## Boundaries

- No Planiprêt data is copied, queried, or used as a replication source.
- No FusionPBX, SIP, WSS, TURN, call routing, or incoming-call configuration is changed.
- No automatic promotion runs without a fencing mechanism and separate health evidence.
- No public DigitalOcean listener or DNS change is enabled before the standby has passed the controlled test.
- A live call cannot be guaranteed to survive a primary failure; the failover objective is safe recovery for new requests and persisted application data.
