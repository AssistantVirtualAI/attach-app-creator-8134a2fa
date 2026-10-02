# Lemtel — Phase 19B: Controlled backend promotion of the configuration lifecycle

Base: `ddd7211f2`.

## Scope
Apply the additive Lemtel migration and publish the authenticated `lemtel-client-config` function. Nothing else.

## Published artifacts
1. Migration `supabase/migrations/20261002220000_lemtel_client_config_lifecycle.sql` — creates only `public.lemtel_client_config_devices` (indexes, constraints, RLS on, no policy, REVOKE anon/authenticated, GRANT service_role only). Executable SQL byte-identical to the Phase 17 offline draft.
2. Function `lemtel-client-config` — `verify_jwt = true`, bearer token also verified in code.

## Security invariants
- Four strict actions: `register`, `manifest`, `revoke_self`, `revoke_device`; strict validation before any database query.
- Manifest never carries SIP identifiers, secrets, endpoints, URLs, hostnames, call data, recordings, voicemail, messages or raw identifiers.
- Credential delivery stays on the separate existing flow, unchanged.
- `direct_current` routing; `edgeFeatureGate: false`; all 10 feature gates stay `false`.
- App/mobile/desktop access checks; SHA-256 installation hash only.
- Own-device binding `user_id + organization_id + softphone_user_id`; revocation irreversible; `revision + state` concurrency; zero-row mutations refused.
- Non-sensitive audit logs only. No PBX, Edge, FusionPBX, Verto, SIP, WebSocket or PJSIP dependency. `pbx_user_devices` untouched.

## Only functional difference from the draft
In `revoke_device`, the admin fallback no longer reads `org_members`. It reads `user_roles` for the calling user **and** `organization_id = target.organization_id`, accepting only `org_admin` or `super_admin`. `is_lemtel_admin` is unchanged. Cross-organization attempts return `forbidden` and change no row.

## Calls
No client calls this function. No real endpoint was invoked during this phase.

## Rollback
Do not drop the table or the function. Stop future consumers and correct only through an approved phase.

## Publication status
See the Phase 19B report for the status signalled by Lovable.
