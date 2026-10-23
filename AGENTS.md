# Project Architecture Rules

- Maestro widget history writes explicit transport success; mirrored classifiers infer legacy null success only for widget sync/release 2xx without failure evidence, preserving explicit business outcomes and access scopes.

- Planipret read/hidden SMS and missed-call state is mirrored, local per user/device; never delete history or call/notification records.
- Planipret transcript diagnostics share a mirrored evidence mapper/notice; native/CDR absence never proves missing audio, provider hints never replace fallback outcomes.

- APNs pushes share one server-only persisted provider-token cache (atomic renewal, single-flight); independent signing hits Apple's refresh limits.
- Both web trees share the call/recording speaker renderer; identity uses explicit source labels, never inferred turns.
- Pending-commission presentation and stylesheet stay byte-identical in both web trees; category totals official, monthly tables labeled allocated.
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
- Planipret SMS/missed/voicemail alerts use pp-row-push triggers (server re-read, recent-only, webhook-shared keys); inboundSmsRow maps real SMS columns to avoid failed inserts. Provider reads alone never prove alert ingestion.
- Commission screens (portal and mobile) read through a per-user 15-minute device cache in ppEdgeInvoke that stores only validated answers and is cleared by the server "updated" broadcast or an explicit refresh.
- Every Planipret number assignment (new broker, portal assign, single DID) goes through assignNumberToExtension in _shared/pp-did-routing.ts: calls, texts and caller ID verified by read-back, old numbers released; partial writes broke texting.
- Admin commissions use changed-only broker/year aggregate buckets and day-indexed windows; no full rescans (CPU budget). Reports never re-warm `stats:` snapshots (different payload). Claude reviews new rows only, advisory.
- Broker telecom changes (portal, app, NetSapiens `subscriber` model) push to Maestro's widget webhook only through `_shared/maestro-widget-sync.ts` (non-blocking, debounced, redacted); omitting external_user_id means release, so never send a partial payload.
- Call handoff is JWT-owned or Maestro-machine-key mapped server-side to one broker extension, targets only canonical <ext>x / <ext>M after registration verification, transfers only the remote leg and never hangs up the source (NS owns answer/rollback semantics); Maestro call events remain allowlisted, non-blocking and disabled unless PP_WIDGET_CALL_EVENTS=1.
- Feedback reply alerts derive the reporter from the saved admin-authored comment server-side; reuse push and a fixed email template with comment-ID keys, never browser recipients.
- Planipret mobile: one active device per broker (pp-mobile-device-claim); other devices' tokens get revoked_at (never deleted), all token readers filter it, sign-out waits for live calls; an app without device id may still register while the claimed device holds no live token, so legacy installs are never locked out.
- Voicemail: mirrored, profile-owned reads; verify audio filename membership, fetch fresh URLs, discard stale responses; preserve caller identity and use account-isolated names.
- Portal AVA reuses the mobile MAvaChat (same tools/endpoints) via PortalAvaLauncher, shown only when planipret_profiles.portal_ava_enabled is true; per-profile opt-in avoids exposing an untested portal surface to all brokers.
- Portal and mobile sign-in require the broker to exist as an active NetSapiens user (pp-ns-access-check, read-only, decide.ts); denial only on proof (404/disabled/no extension), NS outages never lock everyone out.
- Planipret mobile builds run on Codemagic only (codemagic.yaml, artifacts-only workflows planipret-ios-artifact / planipret-android-artifact / planipret-release-artifacts), triggered solely by the pp-mobile-build edge function from the admin portal; never on push, never any store upload without a separate approved workflow.
