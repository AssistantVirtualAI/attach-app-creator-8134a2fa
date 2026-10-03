# Lemtel — Phase 22A threat model

| Threat | Mitigation in this phase |
| --- | --- |
| Leak of forwarding destination, extension number, internal ID or secret | Strict 5-column select; only 4 enum labels projected; `updated_at` only inside an opaque SHA-256 revision; Deno tests assert no field names or values in manifest. |
| Cross-organization pollution | Read bound to `extension_id` + `organization_id`; mirror write bound to `organization_id` + `pbx_uuid`. |
| Account ↔ extension mismatch | Only the authenticated account's own `extension_id`; no fallback by number, address, `raw_data` or destination. |
| Mirror written before PBX failure | Mirror update only after `writeCollection` returns `ok`; failure returns the PBX result untouched. |
| Stale external PBX data | Direct FusionPBX edits converge through existing `sync-extensions`; mirror failure reported as generic `pending_sync`, never as synced. |
| Permissive fallback | Absent/unknown policy → disabled / disabled / not_allowed / disabled; unknown recording values → `not_allowed`. |
| Error disclosure | No mirror error message, ID or value returned or logged. |
