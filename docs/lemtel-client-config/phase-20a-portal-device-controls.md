# Lemtel Phase 20A — Portal device controls

## Scope
The existing Lemtel portal (customer settings, new **Client devices** tab) lets an administrator view and revoke device lifecycle records stored in `lemtel_client_config_devices`.

## Access path
- The portal never reads the table directly. It calls only the authenticated function `lemtel-client-config` (JWT required, `verify_jwt = true`) through `adminInvoke`.
- New action `list_devices` accepts exactly `{ action, organizationId }`; `organizationId` must be a UUID. Invalid input returns stable codes (`invalid_body`, `invalid_organization_id`) and is never echoed.
- Server-side authorization per organization: Lemtel admin (`is_lemtel_admin`) or a `user_roles` row for that exact organization with `org_admin` or `super_admin`. Otherwise `403 forbidden`.

## Minimal metadata
Only `device_ref, platform, state, revision, created_at, updated_at, last_seen_at, revoked_at` are read (max 200, newest first). No internal IDs, users, hashes, credentials, endpoints, call data or media are returned.

## Revocation only
- `revoke_device` (unchanged, optimistic concurrency, audit) is the only mutation.
- No approve, re-enable, delete, recreate or bulk action. Revocation is irreversible in this phase.

## Not changed
No Mobile/Desktop client, PBX, FusionPBX, signaling stack, DNS/TLS, VPS or store. No migration, RLS policy, grant, generated type, package or lockfile.

## Current limitation
No published app consumes the lifecycle yet: revocation does not promise an immediate call disconnection.

## Next step (separate approval required)
Manifest consumption in one client.
