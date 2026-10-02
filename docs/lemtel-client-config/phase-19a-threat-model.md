# Lemtel — Phase 19A threat model

Status: offline contract only. No migration is applied and no function is published.

| Risk | Control |
| --- | --- |
| SIP identifier leakage | Manifest never carries identifiers; delivery stays on the separate authenticated flow; `manifestContainsCredentials: false`; static scan rejects network or secret fields. |
| Cross-organisation access | Every rule is authoritative from the existing portal; future lifecycle binds user + organization + softphone user (Phase 17). |
| Access to another user's device | Owner revocation bound to the owner; admin revocation limited to the admin's own organization. |
| Admin privilege escalation | Admins gain no access to other extensions' private call data; `own_extension_only` is mandatory. |
| CDR/audio data in manifest | `manifestContainsCallData: false`; all data streams are `inManifest: false` on existing authorized flows. |
| Accidental PBX/Edge activation | `pbxConnectionAllowed`, `edgeFeatureGate` false; `direct_current` only; nothing executable. |
| Dual Android SIP owner | `nativeAndroidSipAllowed`, `vertoAllowed` false; JsSIP/WebView sole owner. |
| Planiprêt regression | Permanent isolation verifier must pass before and after; scope test rejects any protected path. |
