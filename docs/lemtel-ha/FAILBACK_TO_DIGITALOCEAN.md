# Failback to DigitalOcean after a Hostinger promotion

State before failback: the arbiter fenced DigitalOcean (powered off) and the Hostinger agent promoted
`lemtel-postgres-hostinger-standby` and started the promoted runtime; the Load Balancer serves Hostinger.
DigitalOcean's database is stale and must never serve again as is.

Every step is a root script in `infra/lemtel-resilience/failback/`, idempotent where possible, refusing before
any change when a precondition is missing, and leaving the previous database directory in place
(`/opt/lemtel-ha/postgres/data.retired-<UTC>`).

| # | Host | Script | What it does | Outage |
|---|------|--------|--------------|--------|
| 0 | DO | (power on) | The boot fence sees Hostinger serving as writer and keeps DO fenced (runtime stopped). | no |
| 1 | Hostinger | `lemtel-ha-hostinger-writer-replication-enable.sh install` | Replication rule, slot `lemtel_do_standby`, relay `10.253.47.1:5432` accepting only `10.253.47.2`. Refused on a standby (the attestation forbids any :5432 listener). | no |
| 2 | DO | `lemtel-ha-do-standby-rebuild-from-hostinger.sh` | Proves a replication login to Hostinger first, retires the old database, `pg_basebackup` from Hostinger, recreates `lemtel-postgres-standby` with the same environment, networks/aliases and hba file. Rolls back on failure. | no |
| S | Hostinger→DO | launcher + `lemtel-ha-do-storage-receive-from-hostinger.sh` | Storage tar applied on DO only if it matches the Hostinger manifest. Nothing deleted on DO. | no |
| 3a | Hostinger | `lemtel-ha-hostinger-writer-handback.sh quiesce` | Requires DO streaming; stops the promoted runtime and its marker, terminates client sessions, checkpoint, prints `final_lsn`. | **starts** |
| S | Hostinger→DO | (again) | Final Storage copy, writes are stopped. | yes |
| 3b | Hostinger | `lemtel-ha-hostinger-writer-handback.sh fence` | Only when DO's replayed position ≥ Hostinger's current one: database stopped, restart policy `no`, relay removed. | yes |
| 4 | DO | `lemtel-ha-do-promote-after-handback.sh promote` | Requires replay ≥ `final_lsn` and Hostinger refusing logins; promotes, synchronous replication off for now, lifts the boot fence, starts the runtime, attests the marker through the DO probe. | **ends** |
| 5 | Hostinger | `lemtel-ha-hostinger-standby-rebuild-from-do.sh` | Removes the promoted runtime/network/storage link/marker units/relay, rebuilds the standby from DO (slot `lemtel_hostinger_standby`), archives incident evidence. Exactly one postgres container remains (attestation). | no |
| 6 | DO | `lemtel-ha-do-writer-synchronous-standby-restore.sh` | `FIRST 1 (lemtel_hostinger_standby)` only if Hostinger streams and becomes `sync`, else reverted to async (writes never blocked). | no |

Afterwards: archive the arbiter incident (`scripts/lemtel-cloudflare-arbiter-incident-archive.mjs`) before the
next sealed bootstrap, and run a no-outage verification (`hostinger_standby_readiness=ready`).

Offline tests: `scripts/lemtel-failback-tooling.test.mjs` (fake docker/systemctl/ss, real filesystem moves).
