# Project Architecture Rules

- Planipret transcript diagnostics use one mirrored frontend evidence mapper and notice; native/CDR absence never proves missing audio, and provider hints never replace the actual fallback outcome.

- Planipret APNs alert, background and VoIP pushes use one server-only persisted provider-token cache with atomic renewal and local single-flight reuse; independent worker signing triggers Apple's refresh limits.

- Planipret call and recording transcripts share the speaker-message renderer in both web source trees; speaker identity comes only from explicit source labels, never inferred dialogue turns.
- Planipret pending-commission presentation and its scoped stylesheet stay byte-identical in both web source trees so portal and mobile expose the same scoped financial view; category totals remain official while monthly tables are labeled as allocated amounts.
- Portal and mobile paid and pending commissions use separate status panels with independent retained filters; switching panels must never merge their financial sources or widen broker access.
- Paid commission summaries, deposits and broker charts share the complete paid-deposit collector, while pending uses its own endpoint; failures never become zero totals and selected-broker admin reads use a server-validated broker-owned credential.
- Commission files and volume (paid and pending, cards, monthly tables, broker table, AVA) count only the receiving broker's own dated Base rows with a positive loan, one file per contract+loan tranche (same key as volume); commission totals keep every category so they match Maestro's official totals.
- Commission screens, AVA and AI insights read server snapshots keyed on a global commission data version; only the 15-minute per-broker change probe (pp-commission-live-sync, batched self-chain) may move that version, so unchanged figures cost no Maestro read and no AI tokens. A row counts as removed only after two consecutive misses because Maestro pagination is unstable.

- Maestro task completion uses the documented soft-delete endpoint and a complete GET read-back; never invent a status option ID or trust mutation success alone.
- Planipret task identity is usage-specific: CRM/commission, assignment, and telecom ids stay distinct; task lists probe verified assignment identities past empty responses and expose only non-sensitive diagnostics.
- AVA customer lookup is profile-first: show verified Maestro details before contact actions, and offer calls, SMS, or email only when explicitly requested.
- Every answered inbound or outbound call requires a persisted post-call CRM/AVA decision; recordings remain in AVA and CRM delivery requires an explicit user action.
- Lemtel UC lives only in src/pages/lemtel-uc, src/components/lemtel-uc, luc_* tables and luc-* functions; never touches Planipret/pbx/legacy Lemtel data — isolation required by product owner.
- AVA chat and voice share one tool registry (_shared/ava-tools.ts) executed by ava-tool-executor; commission answers go through planipret-commission-reports so AVA, portal and mobile show identical validated figures.
- Planipret SMS, missed-call and voicemail phone alerts come from row triggers calling pp-row-push (row re-read server-side, recent-only, idempotency keys shared with ns-webhook-receiver), because NetSapiens webhooks are not the only ingestion path.
- Commission screens (portal and mobile) read through a per-user 15-minute device cache in ppEdgeInvoke that stores only validated answers and is cleared by the server "updated" broadcast or an explicit refresh.
- Every Planipret number assignment (new broker, portal assign, single DID) goes through assignNumberToExtension in _shared/pp-did-routing.ts: calls, texts and caller ID verified by read-back, old numbers released; partial writes broke texting.
- Admin commission dashboards read per-broker/per-year packed buckets (planipret_commission_broker_aggregates), rebuilt only for buckets whose source rows changed, and engine windows use a day index; full rescans of register + live cache exceed the function CPU budget. Stats snapshots (`stats:` keys) are never re-warmed by planipret-commission-reports (different payload). Claude reviews only new rows, advisory.
- Broker telecom changes (portal, app, NetSapiens `subscriber` model) push to Maestro's widget webhook only through `_shared/maestro-widget-sync.ts` (non-blocking, debounced, redacted); omitting external_user_id means release, so never send a partial payload.

- Call handoff is JWT-owned and extension-scoped, targets only the broker’s server-resolved device AOR; Maestro call events remain allowlisted, non-blocking and disabled unless PP_WIDGET_CALL_EVENTS=1.
