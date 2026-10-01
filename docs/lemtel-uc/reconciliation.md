# Lemtel UC — Reconciliation with existing Lemtel (Phase 0)

The existing Lemtel product stays the **single source of truth**. These objects remain canonical:

| Domain | Canonical source |
| --- | --- |
| Tenants / access | `organizations` and `organization_members` (existing membership model) |
| Extensions / softphone users | `pbx_extensions`, `pbx_softphone_users` |
| Devices | `pbx_user_devices` |
| Calls / CDRs | `pbx_call_records` |
| Voicemail | `pbx_voicemails` |
| Recordings, transcripts, AI | `pbx_call_recordings` and existing AI/transcript services |
| Real PBX integration | `fusionpbx-proxy` |

## Status of `luc_*`

- `luc_*` tables and `luc-*` functions are **preview / mock-only**.
- They are not a live data path and do not replace any canonical object above.
- No cross-sync, backfill or migration code exists in this phase; any future unification needs a separate, approved migration plan.
- The `/lemtel-uc` preview shows a non-production notice, accepts no PBX/SIP credential from the browser, and uses the existing shared sign-in (not an independent identity system).

## Platform administrator bootstrap

A database unique index (`luc_memberships_single_platform_admin`) plus the server-only function `luc_bootstrap_platform_admin` (advisory lock + `ON CONFLICT DO NOTHING`) guarantee a single first platform administrator, even under concurrent attempts.

## Phase 0: no write path

- `/lemtel-uc` has **no write path** in Phase 0. The browser UI only reads and displays existing non-production preview data.
- `luc-provision` (`bootstrap`, `create_tenant`, `create_pbx_connection`, `provision_user`, `simulate_events`), `luc-device` (`enroll`, `renew`, `revoke`) and `luc-pbx-adapter` (`validate`, `sync_extensions`) return `409 preview_read_only` with no database, auth/invitation or PBX side effect. `luc-edge` validates the signature, then returns `503 edge_not_enabled` without recording anything.
- Existing Lemtel organizations, extensions, devices, CDRs, voicemail, recordings and the FusionPBX integration remain canonical.
- The existing Lemtel portal is used for all real administration during this preview period.
- Future write operations belong to a separately approved, self-hosted Lemtel Control Plane phase — not this preview.
- The bootstrap database function from the earlier Phase 0 migration remains in place but is no longer called by any LUC function.
