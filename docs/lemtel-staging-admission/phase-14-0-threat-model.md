# Lemtel — Phase 14.0 Threat Model (offline admission)

Scope: static, offline mitigations only. This phase enables no live protection, starts nothing and changes no runtime.

| Threat | Static / offline mitigation |
| --- | --- |
| Accidental deployment | Policy fixes `deployment_allowed`, `runtime_allowed`, `persistent_data_allowed`, `secrets_allowed` and `network_allowed` to `false`; the decision schema fixes the same flags to `false`, even for `admitted`. No deployment file is part of this package. |
| Secret leakage | Schemas accept only booleans, enum states and opaque bounded references; no free text and no credential field exists. The verifier prints stable identifiers only. |
| Backup-bypass claims | Backup and restore prerequisites are two of 13; admission requires all 13 true, so backup alone cannot admit. |
| Policy tampering | The verifier compares every policy value exactly and checks the changed-path scope against the base commit. |
| Premature PBX access | `pbx_integration_approved` is `false`; an admitted decision is rejected while it is false, and admission enables no PBX link. |
| Client cutover | No client, route or app path is in scope; the verifier fails on any out-of-scope path. |
| Denial-code information leakage | Reason codes come from a fixed allowlist naming only the unmet prerequisite, never a value, host or person. |
| Stale evidence | Evidence carries only states; a future phase must re-verify evidence before any decision. A fresh pre-change snapshot is a separate unmet prerequisite. |
