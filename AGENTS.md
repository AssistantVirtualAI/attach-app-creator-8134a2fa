# Project Architecture Rules

- Planipret APNs alert, background and VoIP pushes use one server-only persisted provider-token cache with atomic renewal and local single-flight reuse; independent worker signing triggers Apple's refresh limits.

- Planipret call and recording transcripts share the speaker-message renderer in both web source trees; speaker identity comes only from explicit source labels, never inferred dialogue turns.
- Planipret pending-commission presentation and its scoped stylesheet stay byte-identical in both web source trees so portal and mobile expose the same scoped financial view; category totals remain official while monthly tables are labeled as allocated amounts.
- Portal paid and pending commissions use separate status panels with independent retained filters; switching panels must never merge their financial sources or widen broker access.
- Paid commission summaries, deposits and broker charts share the complete paid-deposit collector, while pending uses its own endpoint; failures never become zero totals and selected-broker admin reads use a server-validated broker-owned credential.
- Funded units are distinct contracts, while volume sums each positive non-adjustment base funding entry even when loan amounts repeat; portal/mobile use the shared engine and complete server analytics, with current-year windows ending today in Toronto, to match Maestro without dropping legitimate repeat fundings.

- Maestro task completion uses the documented soft-delete endpoint and a complete GET read-back; never invent a status option ID or trust mutation success alone.
- AVA customer lookup is profile-first: show verified Maestro details before contact actions, and offer calls, SMS, or email only when explicitly requested.
- Every answered inbound or outbound call requires a persisted post-call CRM/AVA decision; recordings remain in AVA and CRM delivery requires an explicit user action.
- Lemtel UC lives only in src/pages/lemtel-uc, src/components/lemtel-uc, luc_* tables and luc-* functions; never touches Planipret/pbx/legacy Lemtel data — isolation required by product owner.
