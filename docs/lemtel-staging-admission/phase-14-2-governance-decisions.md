# Lemtel — Phase 14.2: Governance Decisions (offline record)

Status: static record of governance decisions only. Nothing is deployed, started, connected or configured. The staging admission remains **denied**.

## Recorded decisions

| Requirement | Decision | Current admission effect |
| --- | --- | --- |
| Monitoring owner | Mohamad Hassoun, AVA | Owner named; alert destination is `mhassoun@assistantvirtualai.com` |
| Log retention | 30 days operational logs; 90 days security logs | Retention selected; implementation is not yet deployed |
| Secrets owner | Mohamad Hassoun | Owner named; no runtime secret store or service secret created |
| Fresh Hostinger snapshot | Create only immediately before an approved deployment change | Still false until the actual pre-change snapshot is created |
| PBX method | Continue software preparation without connecting FusionPBX | Still false pending written FusionPBX design approval |
| Private DNS and TLS | Not yet selected or approved | Still false; recommended future choice is a dedicated staging FQDN plus Caddy and automated Let's Encrypt TLS in a separately approved deployment phase |

## Effect on the admission policy

Naming an owner or selecting a retention period is a decision, not a verified implementation. The corresponding prerequisites (`monitoring_owner_named`, `logs_retention_approved`, `secrets_owner_named`) remain `false` in `schemas/lemtel-staging-admission/staging-admission-policy.json` until the implementation exists and is verified by a future phase. The policy decision stays `denied` with its current reason codes.

These decisions do not enable Docker workloads, ports, DNS, TLS, secrets, an Edge feature gate, a Control Plane runtime, PBX connectivity, client routing, or FusionPBX provisioning. All ten Lemtel Edge feature gates remain literal `false`.

## Next action

Send the English technical-information request for Kenny and Phil: `docs/lemtel-staging-admission/lemtel_email_kenny_phil_fusionpbx_staging_request.md`. Their response will be transformed into an offline integration contract. No credentials or connection information may be pasted into Lovable, source control, or chat.
