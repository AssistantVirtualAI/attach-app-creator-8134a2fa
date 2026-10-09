# Roadmap

- [ ] Restore and verify separate Maestro sources for paid deposits and pending commissions, including Francis; no native changes or partial deployment

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
