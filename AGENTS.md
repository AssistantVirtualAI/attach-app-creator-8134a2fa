# Project Architecture Rules

- AVA SMS stays Marc-only in pp-ava-sms with persisted exact-job SMS/calendar claims and server signatures; external DIDs never grant private tools or weaken confirmations. Existing watch/watch_now ingest provider history. Service-only handoff state guards dispatch; peer takeover records context but only online sessions pause replies. Shared playback releases failed greetings by job version; push failures retain accepted SMS status. Install SQL before coordinated deployment. Web changes never update native binaries.

- AVA email maps to_email to Microsoft to, preserving recipients, confirmation and idempotency.

- AVA financial questions take precedence over directory/history context, execute shared commission tools and render validated figures deterministically; unknown actions never fall back to client lists.
- Commission screens refresh on server update broadcasts or explicit refresh only; returning to a visible tab consumes a pending update without timed polling or unconditional refetches, preserving selected brokers.

- The persistent call screen owns the mirrored useCurrentCallElapsed clock and passes elapsed seconds to the minimized pill; observed ringing-to-connected and dialog changes establish a fresh start, preventing native ring/stale timestamps and minimization from diverging without changing transport or history.

- Vite infers HMR protocol/port from origin; never hardcode secure localhost sockets.

- Portal SMS creation and replies share PortalSmsComposer and the existing JWT-owned pp-ns-sms endpoint; admin compose identity comes from the authenticated session rather than an optional display profile. Never submit a selected broker/sender, automatically retry dispatch, or label acceptance as delivery, preventing impersonation and duplicate texts.
- Portal SMS recipient selection uses authenticated contact, directory and Maestro-client reads; dialogs use global design-system fields rather than page-scoped input CSS, preserving ownership and readability outside the page tree.
- Direct conversation replies reuse PortalSmsComposer in inline mode keyed by authenticated user and thread; only the history scrolls, and all send validation/idempotency remains shared with new messages.
- Native mobile initialization validates extension, device, username and auth-user as one canonical M identity before using credentials; never rewrite W/x credentials to M. Widget association keeps the base external_user_id until Maestro confirms a separate registration override contract.
- Portal extension destinations use a dedicated recipient classifier, not external DID normalization; the existing server owns internal chat dispatch and sender identity, so a missing external DID cannot block extension chat.
- Full conversation views merge the two halves of an internal extension thread through pp-ns-sms `internal-thread` (JWT extension ↔ peer, internal-only peer, peer-authored rows only); duplicates collapse on body + displayed minute, and authorship renders from row ownership, never from the direction field alone. Admin thread pairing must accept both the broker DID and extension as the line side.
- Explicit SMS-test exceptions are checked server-side against owner, recipient, exact body, fixed idempotency key and expiry; the default shared test prohibition stays intact, preventing a browser-controlled general override.

- SMS presentation shares a mirrored evidence classifier; local sent/HTTP acceptance never proves delivery, and deduplication must retain explicit provider status.

- Maestro widget history writes explicit transport success; mirrored classifiers infer legacy null success only for widget sync/release 2xx without failure evidence, preserving explicit business outcomes and access scopes.

- Planipret read/hidden SMS and missed-call state is mirrored, local per user/device; never delete history or call/notification records.
- Transcript diagnostics use mirrored evidence; absent native/CDR data never proves missing audio.

- APNs pushes share one server-only persisted provider-token cache (atomic renewal, single-flight); independent signing hits Apple's refresh limits.
- Both web trees share the call/recording speaker renderer; identity uses explicit source labels, never inferred turns.
- Pending-commission presentation and stylesheet stay byte-identical in both web trees; category totals official, monthly tables labeled allocated.
- Portal and mobile paid and pending commissions use separate status panels with independent retained filters; switching panels must never merge their financial sources or widen broker access.
- Paid commission summaries, deposits and broker charts share the complete paid-deposit collector, while pending uses its own endpoint; failures never become zero totals and selected-broker admin reads use a server-validated broker-owned credential.
- Commissions status panels use the official paid report, not the mixed workbook/live register statistics; portal, broker charts and mobile share the Toronto date cutoff to prevent source and period divergence.
- Mirrored paid-report request normalization applies the official default split before transport/cache identity; aggregate actions strip presentation-only sorting/pagination while deposits retain it, explicit financial filters and broker scope remain intact, and corrected screen caches use a new identity to avoid reusing prior totals.
- Authorized paid report actions reuse server-only per-user/broker/financial-filter row snapshots; unchanged global versions bypass forced rebuilds, expired refresh leases use compare-and-set, and report warming is bounded/sequential to avoid CPU storms.
- Paid summary and broker-table actions share one validated summary snapshot containing both projections; revisioned cache identity prevents legacy action-specific totals from being reused after projection changes.
- Paid commission units/volume (cards, monthly tables, broker table, AVA) = every dated non-adjustment Base row received by the broker with a positive loan (target_name is not a team filter): one unit per contract, volume per distinct contract+loan, matching Maestro "Unités"; pending keeps its own primary-broker rule; commission totals keep every category.
- Commission screens, AVA and AI insights read server snapshots keyed on a global commission data version; only the 15-minute per-broker change probe (pp-commission-live-sync, batched self-chain) may move that version, so unchanged figures cost no Maestro read and no AI tokens. A row counts as removed only after two consecutive misses because Maestro pagination is unstable.
- Maestro task completion uses the documented soft-delete endpoint and a complete GET read-back; never invent a status option ID or trust mutation success alone.
- Planipret task identity is usage-specific: CRM/commission, assignment, and telecom ids stay distinct; task lists probe verified assignment identities past empty responses and expose only non-sensitive diagnostics.
- AVA task lists read Maestro live before an owner-scoped fallback; contextual search runs before pagination and cannot select a task from stale or truncated evidence, preventing false matches without relaxing mutation ownership checks.
- AVA customer lookup is profile-first: show verified Maestro details before contact actions, and offer calls, SMS, or email only when explicitly requested.
- Every answered inbound or outbound call requires a persisted post-call CRM/AVA decision; recordings remain in AVA and CRM delivery requires an explicit user action.
- Lemtel UC lives only in src/pages/lemtel-uc, src/components/lemtel-uc, luc_* tables and luc-* functions; never touches Planipret/pbx/legacy Lemtel data — isolation required by product owner.
- AVA chat and voice share one tool registry (_shared/ava-tools.ts) executed by ava-tool-executor; commission answers go through planipret-commission-reports so AVA, portal and mobile show identical validated figures.
- Planipret SMS/missed/voicemail alerts use pp-row-push triggers (server re-read, recent-only, webhook-shared keys); inboundSmsRow maps real SMS columns to avoid failed inserts. Provider reads alone never prove alert ingestion.
- Commission screens (portal and mobile) read through a per-user 15-minute device cache in ppEdgeInvoke that stores only validated answers and is cleared by the server "updated" broadcast or an explicit refresh.
- Every Planipret number assignment (new broker, portal assign, single DID, created number) goes through assignNumberToExtension: verify voice, target user-specific SMS inventory, known previous SMS-owner removal and caller ID before releasing old numbers. Guardian verify/repair checks SMS against verified voice ownership within the assignment domain, without a new polling mechanism; domain SMS pools can omit assigned numbers.
- Admin commissions use changed-only broker/year aggregate buckets and day-indexed windows; no full rescans (CPU budget). Reports never re-warm `stats:` snapshots (different payload). Claude reviews new rows only, advisory.
- Broker telecom changes (portal, app, NetSapiens `subscriber` model) push to Maestro's widget webhook only through `_shared/maestro-widget-sync.ts` (non-blocking, debounced, redacted); omitting external_user_id means release, so never send a partial payload.
- Call handoff is JWT-owned or Maestro-machine-key mapped server-side to one broker extension, targets only canonical <ext>x / <ext>M after registration verification, transfers only the remote leg and never hangs up the source (NS owns answer/rollback semantics); Maestro call events remain allowlisted, non-blocking and disabled unless PP_WIDGET_CALL_EVENTS=1.
- Feedback reply alerts derive the reporter from the saved admin-authored comment server-side; reuse push and a fixed email template with comment-ID keys, never browser recipients.
- Planipret mobile: one active device per broker (pp-mobile-device-claim); other devices' tokens get revoked_at (never deleted), all token readers filter it, sign-out waits for live calls; an app without device id may still register while the claimed device holds no live token, so legacy installs are never locked out.
- Voicemail: mirrored, profile-owned reads; verify audio filename membership, fetch fresh URLs, discard stale responses; preserve caller identity and use account-isolated names.
- Portal AVA reuses the mobile MAvaChat (same tools/endpoints) via PortalAvaLauncher, shown only when planipret_profiles.portal_ava_enabled is true; per-profile opt-in avoids exposing an untested portal surface to all brokers.
- Portal and mobile sign-in require the broker to exist as an active NetSapiens user (pp-ns-access-check, read-only, decide.ts); denial only on proof (404/disabled/no extension), NS outages never lock everyone out.
- Planipret mobile builds run on Codemagic only (codemagic.yaml, artifacts-only workflows planipret-ios-artifact / planipret-android-artifact / planipret-release-artifacts), triggered solely by the pp-mobile-build edge function from the admin portal; never on push, never any store upload without a separate approved workflow.
- Maestro paid deposits are read per bucket with up to 3 complete reads merged by exact-line fingerprint (minimum multiplicity) until the announced count is reached; Maestro paging repeats and skips lines.
- AVA features are protected by src/test/avaProtectionContract.test.ts plus the src/test/ava*.test.ts suites; any AVA change must keep them green and changing a contract assertion requires explicit owner approval, preventing regressions in working AVA behaviour.
- AVA voice prompt and greeting live only in supabase/functions/_shared/ava-prompt.ts, used by both ava-agent-config and ava-agent-config-preview, so the admin preview always matches real sessions.
- SMS imports share verified-line mapping and idempotent storage; reports use sent_at, not ingestion time.
- Daily reports reuse scoped tasks and mirrored settings; incomplete tasks stay unavailable, send reservation differs from acceptance.
