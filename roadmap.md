# Roadmap

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
