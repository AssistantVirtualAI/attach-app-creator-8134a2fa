# Roadmap

- [ ] Reconcile Sandra pending categories against October 26 Maestro screenshot and live endpoint: investigate Bonus 2 and Override one-cent differences, retain own-files-only, no native edits or unrequested deployment.

- [x] Prepare Manus Android M handoff (2026-10-26): documented exact React/server selection paths, all-broker 1142M/1117M tests, TLS media-engine prerequisite, protected W/x/routing/number invariants, missing separate native source/version access and real-device gates. Specification only, no application/native edits, build or deployment.
- [x] Audit all 84 profile extensions for live non-expired NS registrations (2026-10-26): 13 M, 1 W (Karl 1142), 39 x; 71 have no live M, all device-list reads HTTP 200. One additional legacy 1197_mobile binding. Suffix/registration is not proof of a handset audio engine: some M holders are SIP.js, one KeepAlive, others have no UA.
- [ ] Implement requested all-broker mobile M / portal W / widget x separation: blocked on coordinated installed Android/native repository update and device validation; do not switch M transport/credentials beneath current iOS clients or disconnect Karl's existing W client. No native change, reprovisioning, routing/number change or deployment authorized/performed in this audit.

- [x] Verify Karl 1142 mobile registration without routing/number changes (2026-10-26): authenticated NS device reads show 1142W registered with Planipret Softphone 1.0, 1142x registered with SIP.js, 1142M unregistered. Android implementation deliberately uses W/WSS; M absence is not an Android connection failure. Resolver logs confirm web requests for Karl. Last inbound SIP trace has 180 Ringing, then No Answer CANCEL after 30 seconds; no answered destination INVITE proven.
- [ ] Resolve Karl Android answer/ringback failure: requires installed-app diagnostic at Answer and native release identification from the separate protected repository; current server evidence does not identify a safe repair. No device reprovisioning, native edits, deployment, calls, routing or number changes performed.

- [x] Prepare evidence-based SMS presentation across broker/admin portal and both mobile React trees, preserving provider status during local deduplication. 18 focused tests passed; authenticated portal shows Accepted. Read-only NS session GET HTTP 200: Karl's two messages at 21:16:03/24 UTC remain sending, with no provider error or delivered confirmation. No sends, number changes, native edits or deployment.
- [ ] Activate prepared pp-ns-sms status-preservation changes and validate installed-phone labels: requires explicit deployment/mobile release approval. Carrier delivery blocker for Karl remains unexplained by NS (sending, no error); provider trace required, no retries sent.

- [x] Diagnose widget HTTP 500 from existing redacted evidence only; explicit success logging and consistent legacy-widget history classification prepared for both mobile web trees/admin history and statistics. 44 offline tests passed; preview build OK. October 23: 18 remote HTTP 500 for one broker, stored evidence only http_500; earlier same-broker 200 excludes permanent failure, not malformed identity/configuration. Detailed provider cause unavailable in retained traces. No deployment, data update, native change or Maestro send.

- [x] Finish remaining voicemail server/mobile read fixes: owner-checked filename/audio reads, individual metadata enrichment, caller fallback, fresh URLs/stale-request guard and account/tab reset; server deployed, 35 focused tests pass, live requester nine messages and WAV retrieval HTTP 200, absent filename 404. Release handoff prepared; routing/native untouched.

- [x] Prepare paired voicemail caller presentation: account-isolated directory name, otherwise readable caller number, with phone sublabel when a name exists. 11 tests per tree pass; authenticated list loads nine messages. Existing identity-less records remain unknown; real identified voicemail and next installed mobile release required. No deployment or routing changes.

- [x] Deploy prepared voicemail loading fix only (2026-10-21): pp-ns-voicemail deployment confirmed; authenticated live inbox HTTP 200 with 9 messages and saved HTTP 200 with 0, both sync_failed=false. Nine messages visible in requester web Inbox. 15 tests passed. No call routing/native/frontend publication changes. Installed-phone confirmation remains with user.

- [x] Prepare missing-voicemail correction: NS new/save/trash folders, filename and v2 metadata/audio fields, actual ns_vm_id persistence scoped to profile ID, non-destructive paired mobile merge. 15 focused tests and Deno check pass; preview build OK. No native/routing/webhook/migration/cron changes or deployment.
- [x] Verify deployed voicemail retrieval against NS documentation (2026-10-21): authenticated requester list uses /voicemails/new, returns HTTP 200 and nine messages, persisted as nine profile-owned ns_vm_id rows and visible in the mobile web Inbox. All 84 profiles have a telephone link; 81 have linked accounts. Fifteen mapper tests and Deno check pass. No deployment in this verification.
- [ ] Verify signed installed mobile release for every broker: needs release workstation/signing and broker/device tests. 84 profiles have telephone scopes, 81 linked accounts and zero duplicate scopes; no all-broker login/playback proof. Requester audio download 3,244-byte WAV HTTP 200; older empty recording and nine missing caller identities remain provider evidence gaps. Fresh identified voicemail, phone contact permission/sync and iPhone/Android audible playback required. Mutations/notifications remain separate unverified paths.

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

- [x] AVA chat/voix dans le portail admin et courtier pour Marc-Alexandre seulement (portal_ava_enabled).

- [x] Karl 1142 : 450 540-5253 assigné (appels/textos/numéro affiché relus), 438 953-5017 libéré; fiches locales resynchronisées; widget poussé pour tous.

- [ ] Confirm widget read-back for Megan 1117 and Pierre 1197, and identify the remaining Maestro HTTP 500. Previous authorized synchronization reported 38 accepted and 45 not linked; not rechecked in the Android verification.

- [x] Latest authorized number change supersedes the earlier Pierre choice: Megan 1117 keeps 514 880-1737; Pierre 1197 keeps 438 953-5072. Previous turn reported deletion of 438 953-4992 and 438 842-5105 from NetSapiens and synchronization of local profiles.
- [x] NetSapiens-active gate for portal + mobile (pp-ns-access-check); audit 81/81 allowed. Installed app needs new release for its own check.
- [ ] Android push: replacement FCM_SERVICE_ACCOUNT_JSON securely saved. Live authorized verification 2026-10-22 tested all six Android-linked accounts/seven active tokens: zero Android accepted, six SENDER_ID_MISMATCH and one UNREGISTERED; existing sender removed the unregistered token. Google credential exchange now succeeds, but installed registrations and sender project do not match. Match Firebase project to the installed app before requesting another secure replacement; no new deployment or native change in verification. 81 linked brokers: 41 with an active mobile token, 40 without. Real SMS/missed-call/voicemail/task phone receipt still unverified.
- [x] Prepare Manus daily summary 2026-10-22 with current Android evidence and explicit separation of earlier reported deployments, current source tests, mobile-release requirements and real-phone blockers. 28 focused tests passed in this verification.

- [x] Codemagic artifacts-only CI/CD: codemagic.yaml (3 workflows), release-gates.mjs, pp-mobile-build (preview/start/status, allowlist serveur, anti-double-build, 3/h), page admin « Build mobile ». Aucun upload store.
- [ ] À faire par le propriétaire : créer l'app Codemagic, y déposer les identités de signature (groupes app_store_connect, planipret_ios_signing, planipret_android_signing), puis entrer CODEMAGIC_API_TOKEN + CODEMAGIC_APP_ID via le formulaire sécurisé.
- [ ] Déployer pp-mobile-build + mobile-register-push sur demande.
