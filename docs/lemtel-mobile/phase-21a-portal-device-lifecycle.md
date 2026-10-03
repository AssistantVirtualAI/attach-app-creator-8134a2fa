# Lemtel Phase 21A — Mobile portal device lifecycle

## Authority
The portal stays the authority for Mobile access, devices and configuration.

## Flow
```text
Supabase session restore
  -> useLemtelMobileClientConfig (register, then validated manifest)
  -> existing softphone-credentials hydration
  -> sipConfig
  -> useSoftphone
```
- A portal session registers the device (`register`, platform `mobile`, opaque local `installationRef`) and receives the non-sensitive `lemtel_client_config_manifest_v1`.
- Telephony credentials stay separate and unchanged: they still come only from `softphone-credentials`, and only after the manifest allows it.
- Manual legacy configuration without a portal token stays temporarily allowed (`legacy`), with no lifecycle call.

## Telephony engines
- Android: JsSIP over WSS is the only WebSocket, REGISTER and call owner; the native service stays a foreground/audio/notification helper with no credentials.
- iOS: the existing native path is unchanged.
- Verto is forbidden.

## Policy rules
- Direct current routing only; `edgeFeatureGate` must be `false`.
- Mobile enabled, account active, device approved with action `none`, own-extension privacy, unexpired manifest — otherwise telephony does not start.
- Foreground refresh at most every 900 seconds, only with a known device and no active/ringing call. No interval, worker, cron or background job. An explicit retry runs one attempt.
- Transient failures may reuse only a cached, still-valid, allowed manifest. Expired manifests are refused.

## Revocation
- A blocking policy becomes `pending_block`; it is finalized only after any active or ringing call ends. No automatic hangup, redial, timer or reload.
- Finalization: iOS native disconnect / Android helper stop (JsSIP stops through `sipConfig = null`), manifest cache cleared, local-only sign-out, local Lemtel credentials cleared, simple “Accès Mobile indisponible” screen.

## Local identity limit
The `installationRef` survives sign-out and blocks, so a revoked device cannot silently re-register as new. Uninstall/reinstall creates a new installation.

## Not changed
No FusionPBX, PBX, Edge, VPS, DNS/TLS, desktop, portal, backend, native code or store.

## Next step
Equivalent Desktop phase, after separate approval.

## Phase 21A.1 hardening

- `parseManifest()` now validates every Phase 16 key, opaque reference pattern (`^[a-z0-9][a-z0-9_-]{2,63}$`), strict UTC `Z` dates (0–3 decimals, real calendar date) and every enum, including the four exact `capabilities` keys and `observability`.
- Any ambiguous, incomplete or out-of-contract manifest returns `invalid_manifest` and is refused before SIP; capability values remain non-executable labels.
- No change to the portal, backend, FusionPBX, Android/iOS native, Desktop or Planiprêt.
