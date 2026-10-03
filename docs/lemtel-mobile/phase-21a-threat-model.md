# Lemtel Phase 21A — Threat model

| Threat | Control |
|---|---|
| Revoked device re-registers as new | Stable `installationRef` kept across sign-out, block and cache clear; only uninstall resets it. |
| Telephony starts before policy check | Portal sessions hydrate credentials and build `sipConfig` only when `sipAllowed`; `checking`, `pending_block`, `blocked`, `unavailable` keep `sipConfig = null`. |
| Stale or forged manifest | Strict runtime validation (exact keys, schema version, direct routing, edge false, own-extension privacy, expiry). |
| Offline bypass | Cache used only after a transient failure and only while unexpired and allowed. Unauthorized never falls back to cache. |
| Sensitive data at rest | Cache holds only the safe manifest and a timestamp; no tokens, telephony credentials, endpoints, contacts, call data or media. |
| Information leakage | Stable internal states; server bodies, tokens and refs are never logged or displayed. Block screen shows no device ref or extension. |
| Call disruption | Block deferred until no active/ringing call; no automatic hangup, redial, timer or reload. |
| Refresh storms | 900 s minimum on foreground; one explicit retry; no interval or background job; manifest read never triggers reconnect. |
| Second telephony stack | Hook never opens telephony connections; Android keeps JsSIP as sole owner; Verto forbidden. |
| Global session impact | `signOut({ scope: "local" })` only. |
| Planiprêt impact | Isolation guard before and after; no protected path in scope. |
