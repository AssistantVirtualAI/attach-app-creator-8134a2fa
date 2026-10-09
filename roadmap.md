# Roadmap

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
