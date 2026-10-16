# Lemtel — node status redacted: threat model and gates

> **Source-only, observation-only.** This package is not a deployment, does not create or rotate a secret, does not install or enable a timer, and does not contact DigitalOcean, Hostinger, Cloudflare, DNS, a PBX, or any telephony service. It does **not** enable automatic failover.

## Intent and hard boundary

The only flow designed by this source is:

```text
root-only node publisher -> private Lemtel Edge node-status ingress -> Lemtel platform-admin portal action
```

It is strictly one-way observation. The Edge function accepts a compact, signed status envelope and persists a redacted snapshot. It has no request field, database capability, shell call, provider SDK, routing integration, or timer that can start a runtime, promote a database, fence a node, change DNS, call Cloudflare, or perform failover.

The portal action is `get_node_status`. It is separate from traffic queries, requires an authenticated active platform administrator, has a two-second bounded read, and returns no raw row, history, error, network identifier, host, client, metric, container, telephony information, or content.

## Data allowlist

Only the following values are transmitted or stored:

| Field | Allowed values |
|---|---|
| `nodeRole` | `do_writer`, `hostinger_standby` |
| `observedAt` | Canonical UTC minute only |
| `agentState` | `healthy`, `degraded`, `unknown` |
| `runtimeState` | `ready`, `degraded`, `unknown` |
| `replicationState` | `streaming`, `degraded`, `unknown` |
| `storageState` | `synced`, `degraded`, `unknown` |

Excluded from the envelope, tables, response, status output, and application logs: IP addresses, hostnames, IDs, network configuration, container names, raw errors, raw metrics, client/user data, phone/telephony data, URLs beyond root-only transport configuration, and any content.

The schema uses one current row per fixed role and a 48-hour history keyed by `(node_role, observed_at)`. Row-level security is enabled on both tables. `PUBLIC`, `anon`, and `authenticated` receive no table or function permission. The Edge service role gets only current-snapshot `SELECT` and execution of one constrained recording function; it gets no history-table access. The browser reaches data only through the admin Edge action.

## Threat controls

| Threat | Source control |
|---|---|
| Browser submission or CORS abuse | No CORS headers; only POST; `Origin` and `Sec-Fetch-Mode` are denied. |
| Forged/replayed status | Per-role HMAC SHA-256 over the exact canonical compact JSON; distinct runtime secret names for writer and standby; UTC-minute range and skew bounds; idempotent history key. |
| Oversize/parser abuse | `Content-Length` check plus streaming body cap of 384 bytes; strict UTF-8, exact fields/types/order, fixed enums, and canonical date. |
| Secret/configuration exposure | Publisher accepts only a root-owned regular 0600 file with one link and secure parent directories; no `source`, `eval`, command argv secret, verbose curl, or secret printing. |
| Sensitive data persistence | Column-only schema and SQL checks; no JSON/opaque payload column; no identifier, message, metric, or content field exists. |
| Misleading stale status | The portal changes all state fields to `unknown` after 180 seconds or if a timestamp is future-dated. Absence is a non-blocking `not_configured` response, not a fabricated healthy state. |
| Remote control or automatic failover | No control endpoint, remote command, provider client, DNS/routing call, promotion, fencing, runtime start, timer installation, or automatic activation is present. |

## Separate future gate (not implemented or authorized here)

A later operator-approved change would need, at minimum: a reviewed transactional schema/Edge/route package; proof that ingress and proxy access logs do not retain request data; separate generated runtime secrets for each role; a root-only configuration review on each intended node; synthetic HMAC, SQL/RLS, and platform-admin RBAC tests; a documented rollback; and an explicit change approval for local installation and timer enablement.

The included `systemd` files are **examples only**. They are not installed, copied, enabled, started, or referenced by any build/CI hook. The service contains no write paths and the timer is disabled until a separate phase manually installs and enables it. Passing any observation gate is never a promotion, routing, or automatic-failover authorization.
