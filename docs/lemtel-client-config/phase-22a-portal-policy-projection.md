# Lemtel — Phase 22A: Portal → client manifest policy projection

Baseline `1467ed489`. Six files only. No migration, table, view, RLS, role, generated type, package, lockfile, config, routing, Edge, credential, Mobile, Desktop or portal React change.

## Source of truth

| `pbx_extensions` mirror | `telephonyPolicy` label | Rule |
| --- | --- | --- |
| `do_not_disturb` | `dndState` | `true` → `enabled`, else `disabled` |
| `forward_all_enabled` | `forwardingState` | `true` → `enabled`, else `disabled` |
| `call_recording` | `recordingPolicy` | `inbound`/`outbound`/`all` → `portal_managed`, else `not_allowed` |
| `voicemail_enabled` | `voicemailPolicy` | `true` → `enabled`, else `disabled` |
| `updated_at` | `manifestRevision` | hashed into the opaque revision, never returned |

`lemtel-client-config` reads at most one row with `EXTENSION_POLICY_COLUMNS`, bound to the account's `extension_id` **and** `organization_id`. The legacy `pbx_softphone_users.dnd_enabled` / `forward_enabled` flags are no longer read. `register` and `manifest` use the same builder with the same resolved policy.

## Restrictive fallback

No `extension_id`, no row, or mirror read error → `disabled` / `disabled` / `not_allowed` / `disabled`. The manifest stays available; nothing is logged.

## Write path

The existing Portal extension editor (`fusionpbx-proxy` `update-extension`) remains the only write path. After a successful PBX write only, the proxy updates the matching `pbx_extensions` row (`organization_id` + `pbx_uuid = extension_uuid`) with only the policy fields present in the payload (`do_not_disturb`, `forward_all_enabled`, `voicemail_enabled`, `call_recording` from `user_record` ∈ none/inbound/outbound/all). It returns `policyMirror: "updated"` or a generic `"pending_sync"`; no retry, no global sync. A change made directly in FusionPBX waits for the existing `sync-extensions` mechanism (`mapExtension` now also projects `forward_all_enabled`).

## Client behavior

Clients receive only safe labels. Call behavior on Mobile/Desktop does **not** change in this phase.

## Limits and next phase

Not tested against real users or extensions. Next phase: controlled consumption of these labels in clients, with on-device tests before release.
