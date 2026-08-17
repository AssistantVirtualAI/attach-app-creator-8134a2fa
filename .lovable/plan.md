# Full audit and end-to-end test of Planiprêt Mobile

Goal: verify every major surface of the app works in production conditions, with evidence (correlation IDs, screenshots, logs) for each test.

## 1. Identity and Maestro connection
- Sign in with a real broker account, connect Maestro OAuth, confirm the resolved Maestro CRM ID is the live one (not a dev ID) and the Telecom user ID resolves from it.
- Disconnect/reconnect: confirm old identity is purged (contacts cache, threads, calls) and no stale data reappears.
- Verify a second broker account sees only its own data (isolation check).

## 2. Maestro data surfaces
- Clients/contacts list: loads from the correct Maestro ID, search works, contact detail opens.
- Communications: send one outbound SMS, receive one inbound SMS, place one outbound call, receive one inbound call.
- For each item confirm it appears in Maestro Communications under the right customer, exactly once (no duplicates).
- Verify recording permalink, transcript, AI summary and notes are attached to the same Maestro call record.
- Record correlation ID, HTTP status and Maestro object ID for every write; list any that stay `maestro_pending` or `maestro_failed`.

## 3. Calls and call logs
- Outbound + inbound over SIP: audio both ways, speaker toggle, mute, hold, transfer, DTMF.
- Background and locked-screen incoming call answers correctly, single CallKit screen only.
- Call history page: entries match the PBX CDRs, correct direction, duration, timestamps in America/Toronto.
- Recordings: playback and download work; voicemail list, playback, delete, custom greeting.

## 4. SMS threads
- Thread list ordering and unread counts.
- Conversation view: no duplicate bubbles (orig/term dedupe), scroll up loads older messages, scroll down sticks to newest.
- Optimistic sent message reconciles with the server copy instead of duplicating.

## 5. Microsoft 365
- Microsoft sign-in from mobile and from the broker portal.
- Emails list/read, calendar month view, Teams messages where wired.
- Token refresh after expiry; behaviour on a slow/cellular connection.

## 6. AVA chatbot and voice bot
- Chatbot: answers with access to the connected broker's client profiles, respects tenant isolation, tool calls (lookup contact, call/SMS actions) succeed.
- Voice bot: session starts, mic/speaker routing correct, no "Connexion vocale interrompue", reconnect loop recovers after network drop.
- Confirm the call summary produced by AVA is pushed to Maestro and attached to the right call.

## 7. Resilience and platform
- Cellular / weak-Wi-Fi run of the critical flows (login, contacts, SMS, call) with timeouts observed.
- App relaunch, background/foreground cycling, SIP re-registration after network switch.
- iOS and Android parity checks; consent gate and privacy screens present.

## 8. Backend health
- Review edge function logs for the audit window: error rates for Maestro, telecom, AVA and M365 functions.
- Database check for unsynced calls/messages and stuck retry rows.
- Security/RLS spot checks on broker-scoped tables.

## Deliverable
A single report listing, per test: pass/fail, evidence (correlation ID, screenshot, log excerpt), root cause for each failure, and a prioritized fix list. Failures are grouped as blocking, degraded or cosmetic.

## Technical notes
- Automated parts: existing vitest suites, `pp-pipeline-audit`, edge function log queries, DB queries for unsynced/pending rows.
- Manual parts: real SIP calls, CallKit/background behaviour, Microsoft sign-in, voice bot audio.
- No code changes during the audit phase; fixes are proposed afterwards in a separate plan.
