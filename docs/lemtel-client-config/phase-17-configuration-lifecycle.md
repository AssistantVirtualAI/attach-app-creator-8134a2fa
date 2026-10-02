# Lemtel — Phase 17: Configuration Manifest and Device Lifecycle (offline source)

Base `0f95bbbce`. **This phase is source-only and not deployed.** The project environment applies database change files and publishes server functions automatically, so the owner chose to keep both offline:

- `docs/lemtel-client-config/phase-17-offline/20261002040000_lemtel_client_config_lifecycle.sql` — not applied.
- `docs/lemtel-client-config/phase-17-offline/lemtel-client-config/index.ts` — not deployed.
- `docs/lemtel-client-config/phase-17-offline/lemtel-client-config/index_test.ts` — offline Deno unit tests.

A later, separately approved phase moves them to `supabase/migrations/` and `supabase/functions/` with byte-identical content.

## Authority

The current portal user, domain, extension and platform access in `pbx_softphone_users` stay authoritative. `pbx_user_devices` is not read or changed.

## Credentials

Existing credential delivery (`softphone-credentials`) remains separate and unchanged. The manifest never carries credentials; it only holds an opaque `credentialRevisionRef`.

## Device model

A device is a server-issued opaque lifecycle record (`lemtel_client_config_devices`), not the old portal device record. The installation reference is stored only as a SHA-256 digest. One permanent record exists per user, platform and installation; re-registration reuses it. A revoked record stays revoked: re-registration never reactivates it.

## Actions

`register`, `manifest`, `revoke_self`, `revoke_device`. Strict bodies; unknown fields are rejected before any database query. Users act only on their own devices; organization administrators revoke only inside their own organization; cross-organization revocation returns `forbidden`.

## Revocation

Revocation blocks future manifest responses. Phase 19/20 later teach clients to clear local SIP state.

## Not changed

No direct PBX, Edge, Verto, Maestro action, AVA action, SSO flow, DNS/TLS/VPS/Docker or client code changes occur. Direct routing stays the only route; `edgeFeatureGate` is `false`.

## Next

A dedicated later portal reconciliation phase will connect portal controls/UI to this lifecycle model before client integration.
