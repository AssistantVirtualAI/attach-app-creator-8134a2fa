# Lemtel — Phase 19A: Portal → client reconciliation contract

Status: offline contract only. No migration is applied and no function is published. No client, portal, PBX, FusionPBX, Edge, DNS/TLS, VPS, Docker or store change.

## 1. Existing portal objects and source of truth

| Object | Source of truth |
| --- | --- |
| organization | existing Lemtel portal |
| domain | existing Lemtel portal |
| softphone_user | existing Lemtel portal |
| extension (DND, forwarding, recording, voicemail policy) | existing Lemtel portal |
| device | existing Lemtel portal (future Phase 17 lifecycle) |
| call_history / CDR | existing authorized flow |
| recording | existing authorized flow |
| voicemail | existing authorized flow |
| message | existing authorized flow |

## 2. Portal mutations and future revision to invalidate

| Portal action | Revision consequence |
| --- | --- |
| `organization_create` | manifestRevision |
| `organization_disable` | manifestRevision |
| `domain_create` | manifestRevision |
| `domain_disable` | manifestRevision |
| `user_create` | manifestRevision |
| `user_disable` | manifestRevision |
| `extension_create` | manifestRevision |
| `extension_disable` | manifestRevision |
| `app_access_change` | manifestRevision |
| `mobile_access_change` | manifestRevision |
| `desktop_access_change` | manifestRevision |
| `sip_secret_rotation` | credentialRevisionRef |
| `dnd_change` | manifestRevision |
| `forwarding_change` | manifestRevision |
| `recording_policy_change` | manifestRevision |
| `voicemail_policy_change` | manifestRevision |
| `device_register` | deviceRevision |
| `device_manifest_request` | none |
| `device_revoke_owner` | deviceRevision |
| `device_revoke_org_admin` | deviceRevision |

`credentialRevisionRef` is only an opaque reference that must be incremented; the SIP secret itself is rotated and delivered only through the existing separate `softphone-credentials` authenticated flow.

## 3. Strict separation: manifest / SIP identifiers / call data

- The manifest carries configuration labels and invalidation revisions only.
- SIP identifiers are delivered only by the separate authenticated server flow (`separate_authenticated_server_flow`), unchanged.
- Call history/CDR, recordings, voicemail, messages and devices are never copied into the manifest. They are read through their existing endpoints with the existing extension/user filter and authorization, always `own_extension_only`.

## 4. Compatibility

- Current direct route remains the only active route (`direct_current`); `edgeFeatureGate` stays `false`; all 10 feature gates stay `false`.
- No FusionPBX change. No mobile, desktop or portal change. Android keeps JsSIP/WebView as the sole SIP owner; no Verto, no native Android SIP.

## 5. Limits and prerequisites before Phase 19B

- This phase validates a contract only; it executes nothing.
- Future work declared (not implemented): `mobile_manifest_consumer`, `desktop_manifest_consumer`, `portal_device_controls`, `portal_mutation_revision_hook`.
- Prerequisites: separate review of the Phase 17 offline sources; explicit approval; Planiprêt isolation guard passing.

## 6. Next phase

Phase 19B: separate review and approval before moving the Phase 17 offline sources into the real backend migration and function paths. Nothing moves without that approval.
