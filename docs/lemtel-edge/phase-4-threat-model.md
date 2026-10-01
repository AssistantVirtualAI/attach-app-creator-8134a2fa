# Lemtel Edge - Phase 4 threat model

Phase 4 is a specification only. The mitigations below are implementation requirements for future phases, not activated controls.

| Threat | Asset | Mandatory future mitigation | Residual risk |
|---|---|---|---|
| Credential exfiltration | Telephony secret material | Secret read only by the future Edge from a server-side secret manager; clients get opaque references only | Compromise of the Edge host itself |
| Tenant / extension cross-access | Tenant isolation | Every decision checks tenant, extension and device references together; mismatch denies | Misconfigured binding records |
| Replay | Capability and resolution messages | Short expiry, unique request references, replay rejection | Short window before expiry |
| Revoked device reuse | Device binding | Revocation checked before expiry; revocation notices propagated to the Edge | Propagation delay |
| Edge impersonation | Resolution channel | Mutually authenticated, signed server-to-server channel; Edge instance reference must be authorized | Theft of the Edge identity |
| Log leakage | Secrets and identities | Opaque references only; secret material never logged | Operator error in future log settings |
| Stale authorization | Capability state | Maximum 12 hour lifetime; re-evaluation on every resolution | Decisions valid until expiry |
| Configuration drift | Edge templates and contracts | Phase 3 preflight and Phase 4 static checks before any later phase | Drift outside checked files |

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
