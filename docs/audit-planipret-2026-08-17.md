# Full audit — Planiprêt Mobile + backend pipeline
Date: 2026-08-17 (UTC). Window analysed: last 7–30 days.

## Summary

| Area | Verdict |
|---|---|
| Automated test suites (portal + mobile) | PASS (103 tests) after fixes |
| SIP calling / reconnect / audio guards | PASS (unit + e2e suites) |
| SMS delivery (NetSapiens) | PASS (HTTP 202) |
| SMS push to Maestro Communications | FAIL — Maestro returns HTTP 500 |
| Call CDR push to Maestro | FAIL — Maestro returns HTTP 500 |
| Recording upload to Maestro | BLOCKED — media not ready + missing Maestro call ID |
| Transcripts / AI summaries (local) | PASS (21/37 transcripts, 20/37 summaries in 7d) |
| AVA chatbot / voice bot | Backend active (21 sessions, 34 conversations in 7d); device audio needs manual pass |
| Microsoft 365 | Inbox integration tests PASS; live sign-in needs manual pass |
| Database security linter | 185 findings, all INFO/WARN (no ERROR) |

## Fixes applied during the audit

1. `src/services/__tests__/avaProactive.test.ts` — the AI consent gate was not mocked, so `callAva` short-circuited and 2 tests failed. Added consent + `supabase.auth` mocks.
2. `src/pages/planipret/mobile/__tests__/EmailsList.integration.test.tsx` — `supabase.auth.getSession` was missing from the mock (the inbox now guards auto-sync behind an active session), leaving the list stuck on the loading skeleton. Added a session mock and a jsdom Blob-URL guard. Synced the mobile copy.
3. `apps/planipret-mobile/vitest.config.ts` + `src/test/setup.ts` — the mobile app had no vitest config, so its React tests ran in a Node environment (`document is not defined`). Added jsdom, globals, setup file and the app aliases.

Result: root 50/50 tests pass, mobile 53/53 tests pass.

## Confirmed defects (evidence)

### 1. Maestro Communications rejects SMS pushes — HTTP 500 (blocking)
- `POST /api/v1/users/387460525/messages` → `{"message":"Server Error"}`, correlation `09728f90-…` at 21:19 UTC today.
- Same 500 for telecom ID `93135` and for `285983`, over several days.
- One earlier attempt returned HTTP 422 `to_user_number est obligatoire` even though the payload carried `+15147727519`.
- The SMS itself is delivered: `sms_send` step returns 202 from NetSapiens.
- 8 of 50 messages in the last 7 days remain `maestro_synced = false`.
- Cause is on the Maestro side (or an undocumented required field); our request contract must be confirmed with Maestro before more retries.

### 2. Call CDR push fails — HTTP 500 (blocking)
- `POST https://client.planipret.com/telecom/api/v1/users/{id}/calls?machine=1` → 500, `client_id: null`.
- 18 of 37 calls in the last 7 days have no `maestro_call_id` (252 of 346 over 14 days).
- 5 CDR retries were abandoned after repeated 500s; 21 older retries abandoned with `broker_id_unresolved_for_user`, 6 with HTTP 401.

### 3. Recordings never reach Maestro (blocking, downstream)
Last 30 days of `planipret_recording_uploads`:
- 78 `abandoned` — `media_not_ready_after_24h` (NetSapiens never exposed the media file)
- 47 `pending` — `media_not_ready`
- 13 `skipped` — `maestro_call_id_missing` (direct consequence of defect 2)
- 1 `synced`, 1 `failed`
Only 2 of 37 recent calls have a `recording_url` locally.

### 4. Broker linkage coverage (degraded)
16 of 222 profiles have a `maestro_broker_id`. Every unlinked broker's calls and SMS can never sync. Needs a linkage campaign or an onboarding gate.

### 5. Security linter (informational)
185 findings, none at ERROR level: one RLS-enabled-no-policy table and a large set of `SECURITY DEFINER` functions executable by `anon`. Recommend revoking `EXECUTE FROM anon` on the definer helpers that are only used server-side.

## Verified working
- SIP transport recovery guard: single WebSocket, backoff floor, UA rebuild (8 tests).
- Voicemail audio switching: no freeze across 20 file switches / 10 open-close cycles (5 tests).
- Mobile email inbox: open + mark read, pagination merge, ≤3 MB attachment download, reply/forward (4 tests).
- SMS deduplication (orig/term, optimistic reconciliation, timezone handling).
- AVA proactive service: normalisation, fallback, suggestion routing (call/SMS/reminder/Maestro action).
- `pp-ns-cdr` scheduled runs: 62 successes in 7 days, no failures.
- `pp-devices-expiry-guard`: 28 OK runs.

## Not covered here (requires a physical device)
Real inbound/outbound SIP audio, speaker/mute/hold/transfer, locked-screen CallKit answer, Microsoft interactive sign-in, ElevenLabs voice-bot audio, cellular-network behaviour, iOS/Android store builds.

## Recommended fix order
1. Get the exact accepted payload for `POST /users/{id}/messages` and `POST /users/{id}/calls` from Maestro; adjust the contract, then replay the unsynced 8 messages and 18 calls.
2. Re-enable recording upload once calls carry a `maestro_call_id`, and add a NetSapiens media-readiness backoff longer than 24 h (or a fallback fetch path).
3. Run a broker-linkage backfill so every active broker has a Maestro/Telecom ID.
4. Tighten `anon` EXECUTE grants on SECURITY DEFINER helpers.
