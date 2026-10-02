# Lemtel — Phase 17 Threat Model

| Threat | Code-level prevention | Later integration test |
|---|---|---|
| Account/device enumeration | Stable codes; unknown target in admin revoke returns `forbidden`; no input echoed. | Probing many refs yields identical responses and no identity. |
| Guessed `deviceRef` | Server-generated 128-bit ref; every user query filters by `user_id` (and platform). | User B cannot fetch or revoke user A's device with A's ref. |
| Cross-org admin revocation | Target organization read first; org admins must be members of that organization. | Admin of org X gets `forbidden` for org Y device. |
| Revoked-device reactivation | `resolveRegistration` returns `revoked`; no code path sets `approved` on a revoked row. | Re-register after revoke returns `device_revoked`. |
| Duplicate registration | Unique `(user_id, platform, installation_ref_hash)`; reuse existing record. | Concurrent registers create one row. |
| Secret/endpoint leakage | Explicit safe column list; manifest built from enums/booleans/opaque refs only. | Response scan finds no credential, host, extension or forwarding target. |
| Manifest replay/expiry | `issuedAt` + 15-minute `expiresAt`; revision refs change with device revision. | Client rejects expired or older-revision manifest. |
| Platform denial bypass | `accessFailure` checks global and per-platform flags before any device action. | Disabled desktop returns `platform_access_disabled`. |
| Manifest/credential confusion | Manifest has only `credentialRevisionRef`; credentials stay in the existing separate function. | No credential field in any manifest response. |
| Malicious input/unknown fields | `validateBody` strict keys, types and patterns before database access. | Fuzzed bodies return stable 400 codes. |
| Accidental PBX/Edge/Verto coupling | No network calls; tests forbid these strings and imports. | Static scan in CI keeps the function free of them. |
