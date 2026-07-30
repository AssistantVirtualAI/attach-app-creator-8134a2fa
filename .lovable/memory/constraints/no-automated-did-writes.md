---
name: No automated DID writes (NetSapiens)
description: Never write/repair NetSapiens DID (phonenumber) routing via API — portal is the source of truth
type: constraint
---

NEVER write DID/phonenumber routing to NetSapiens via API (no `PUT /domains/{d}/phonenumbers/{n}`, no bulk `repair_dids`). Automated rewrites destroyed the carrier-side DID→user assignments and Scott (NetSapiens) asked us to stop.

**Why:** DID assignment is owned and managed in the NetSapiens portal. Our API rewrites overwrote `dial-rule-application` / `dial-rule-parameter` on numbers we didn't own.

**How to apply:**
- `pp-admin-phonenumbers` action `repair_dids` is permanently disabled (returns `bulk_did_repair_disabled`).
- `pp-sync-answering-rules` has `repair_dids` hard-coded to `false`.
- Answering-rule / SimRing sync is still allowed; only phonenumber objects are off-limits.
- Do not re-enable without explicit written approval from the user.
