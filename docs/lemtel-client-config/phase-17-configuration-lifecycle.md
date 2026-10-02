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

## Phase 17.1 hardening

- **Full own-device binding:** every own-device read and write is bound to the authenticated user, the current account organization and the current softphone account (`user_id`, `organization_id`, `softphone_user_id`). These internal IDs are never returned.
- **Device reference format:** the database draft enforces `^dev_[0-9a-f]{32}$` (`lemtel_ccd_device_ref_format_check`), matching the server-generated default.
- **Zero-row/stale rejection:** every update and revocation filters on the expected revision and state, returns the changed row, and fails safely when no row changed; a zero-row mutation never produces a success response.
- **Offline only:** the offline source was deliberately retained outside `supabase/` and remains undeployed. In the final repository state, no applied migration path and no function path exist for it.

## Revocation

Revocation blocks future manifest responses. Phase 19/20 later teach clients to clear local SIP state.

## Not changed

No direct PBX, Edge, Verto, Maestro action, AVA action, SSO flow, DNS/TLS/VPS/Docker or client code changes occur. Direct routing stays the only route; `edgeFeatureGate` is `false`.

## Next

A dedicated later portal reconciliation phase will connect portal controls/UI to this lifecycle model before client integration.
