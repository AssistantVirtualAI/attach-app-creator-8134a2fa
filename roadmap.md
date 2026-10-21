# Roadmap

- [x] Prepare missing-voicemail correction: NS new/save/trash folders, filename and v2 metadata/audio fields, actual ns_vm_id persistence scoped to profile ID, non-destructive paired mobile merge. 15 focused tests and Deno check pass; preview build OK. No native/routing/webhook/migration/cron changes or deployment.
- [ ] Activate and verify missing-voicemail correction: requires explicit targeted pp-ns-voicemail deployment approval, next mobile release, and a real provider voicemail read-back/playback. Authenticated existing inbox returned HTTP 200 but no messages; platform has zero voicemail rows. Provider subscription/notification delivery not established.

- [ ] Verify SMS/missed-call/voicemail screen alerts for all brokers: SMS mapper deployment reported in previous turn, actual delivery still unverified. Read-only global audit 2026-10-20: 84 profiles, 81 linked; all three preferences enabled; 45 profiles have iOS tokens, 7 Android, 31 linked profiles have no active mobile token. Android Google rejects the configured signature (fresh pp-push-notify log); credential replacement requires authorized valid Google configuration. No voicemail rows platform-wide. Last 24h: one inbound SMS and two inbound missed rows have no matching alert evidence. All four row-push triggers enabled; no pp-row-push logs. Shared HTTP-response 401s cannot be attributed to row-push from aggregates alone. Blockers: Android credential, missing device registrations, live event/device verification and voicemail ingestion/subscription evidence. No broadcast test sent; no code/configuration/native/credential changes or deployment in this audit.

- [x] Prepare admin feedback reply alerts in portal/mobile: server-derived reporter, existing push + fixed email template, stable comment-ID keys; 14 server + 6 portal + 6 mobile tests pass, Deno check and preview build OK.
- [x] Deploy approved feedback reply endpoint and email preview (2026-10-19); 14 server + 6 portal + 6 mobile tests pass, Deno check and security gate OK. One explicit self-test push accepted by native provider; authenticated mobile Feedback link opens. No app publication.
- [ ] Verify actual feedback reply phone/email delivery and report-specific opening: requester has no own reports and self-replies are intentionally skipped; needs a reply authored by a different authorized administrator. Email send path verification timed out; no email test sent. Phone receipt/tap requires user's confirmation.
- [x] Compare MMore intentional differences: autonomous mobile DND confirmed/busy, Marketing, AVA Statistic and Microsoft path preserved; quick reply helper/settings equivalent, 11 targeted tests pass. No full-file copying.
- [ ] Reconcile three native safety failures with validated candidate: RX adjustment prohibition, stale-end literal, generation guard expressions. Requires separate protected-native review; no native or test weakening performed.
- [ ] Obtain fresh portal/mobile TypeScript and production build results from automated validation or Manus; manual builds/typechecks prohibited by environment, no fresh outputs available this turn.

- [x] Add missed-call mark-one/mark-all read controls in both web-mobile trees; 5 tests pass in each tree, authenticated 13-call history retained after clearing, reload persistence and mark-unread verified at 390px without overflow; build OK, no native/server changes or deployment. Read status is per user/device, not synchronized with the main bell.

- [x] Replace generic Planiprêt transcript errors with evidence-based diagnostics in both web source trees; 20 focused tests pass, browser notice/retry verified, build OK; no native edits or publication.
- [ ] Verify transcript diagnostics on a real call: requesting user's authenticated call screen returned no calls; requires an accessible recorded call. No installed-device verification performed.

- [x] Restore Sandra and all brokers' own Maestro tasks across portal/mobile using usage-specific identities and the owner-scoped synchronized projection; Sandra's authenticated endpoint now returns 230 tasks and 57 focused task/commission tests pass.

- [x] Split broker mobile commissions into bilingual Pending/Paid panels with portal-parity colored monthly/quarterly reports; both web-mobile trees are identical and 31 focused tests pass in French and English; authenticated panel switching verified, no native edits or publication.

- [x] Separate pending and paid portal commissions into status tabs, with independent broker/name/global and month/quarter/year filters; six tests passed and authenticated Sandra selection/period retention verified; no native edits or publication.

- [x] Harmonize portal pending commissions with paid visual presentation: broker/period filters, colored charts, category and monthly tables; preserve official amounts and separate sources. Four presentation tests passed; Sandra categories and team/monthly controls verified in authenticated preview.

- [x] Redesign the admin broker commissions page with portal colors, broker/team filters, visual charts, and richer comparison tables without changing commission calculations.

- [x] Correct current-year Toronto date windows and funded-entry volume (unique contracts only for units); real paid rows now compute 548 units and 174,501,286.33 volume with matching lender sum; 31 root and 14 app-web tests pass, no native edits.
- [ ] Reconcile Sandra commission reference 1,368,881.05 against paid API rows totaling 1,369,382.91 (501.86 difference): requires detailed Maestro export for Jan 1–Oct 9; hold coordinated publication until fully reconciled, no partial deployment.

- [x] Restore complete server lender analytics and stable paid pagination in both mobile web trees; selected-broker portal uses the same CY/PY paid source, admin includes live cache; repeat-funding volume correction supersedes the earlier 173,412,586.33 calculation.

- [x] Show exact official pending totals and all six Maestro categories in both web source trees; Sandra Base 179,887.26 and total 331,146.08 verified via admin-selected portal/mobile views; 10 tests passed, no native edits or publication

- [x] Restore separate Maestro paid deposits and pending endpoints; verify Francis and Sandra through authenticated admin-selected views, both sections rendered, 23 tests passed; no native edits or app publication
- [ ] Verify commissions inside Francis's own mobile session (minted session redirects to mobile sign-in; requires Francis to sign in through Microsoft)

- [x] Redesign pending commissions for admins and brokers across portal and mobile (summary, monthly trend, type breakdown, searchable broker ranking and personal monthly detail)

- [x] Verify mplanipret access-check failures preserve the session and allow retry (network abort exercised, zero logout requests, real calls returned after retry)
- [x] Implement and verify approved cross-worker Apple provider-token reuse for alert, silent and VoIP pushes (19 tests passed; real server reuse across 6 concurrent workers and cold start; anonymous/authenticated cache access denied; all 3 deployed entrypoints respond 200)
- [ ] Confirm incoming-call delivery on a real iPhone (requires an agreed live phone test)

- [x] Refine transcript speaker labels, message spacing and text readability; verified on a real 30-turn transcript (28px message gaps, 15px text, no horizontal overflow) and 5 renderer tests; web presentation only, no native changes or publication

- [x] Make call details dismissible outside the panel without changing tabs
- [x] Present verified transcript speakers as distinct message bubbles
- [x] Verify authenticated outside-tap dismissal and speaker rendering regression tests (verified on a real call: 30 turns, distinct speakers)
- [x] Fix transcript/recording 404 for calls keyed by ns_call_id (server-side resolveCallRow fallback in ns-get-transcription + ns-get-recording, deployed)

- [x] Preserve every phone-system recording in AVA regardless of CRM choice
- [x] Make CRM delivery explicit and remove automatic delivery
- [x] Improve recording availability states and restore eligible hidden records
- [x] Add a reliable return-to-app action in the mobile-opened portal
- [x] Add regression tests and verify the central flows

- [x] Admin pending commissions: filtres courtier / équipe / mois / trimestre / année (portail Gilles & Marc), commissions par broker poussées au portail + app
- [x] SMS threads: read/unread, mark-all-read, device-local delete (hide)

- [x] Claude tokens step 1: tracking deployed (41 AI functions, 2026-10-18); steps 2-4 (cache answers, trim prompts, Haiku test) wait on 3-7 days of measurements
