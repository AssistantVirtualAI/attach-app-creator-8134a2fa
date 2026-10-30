# Daily email summary for brokers — complete, readable, scheduled

## Problem
- AVA's summary only reads the last 20 emails and dumps raw previews ("… et d'autres courriels").
- It is sent as plain text, hard to read, and asking AVA to send it is clumsy.
- There is no reliable daily automatic send.

## What the broker will get
A branded Planiprêt email, every business day at a chosen time (default 7:30 and/or 17:00 Toronto), sent from the broker's own Microsoft 365 to himself:

1. **Header** — date, counts (received, unread, needing reply).
2. **À traiter en priorité** — emails needing action/answer, each with sender, subject, 1-line AI summary, suggested action.
3. **Clients et dossiers** — emails from known Maestro clients/lenders grouped by client.
4. **Informations / infolettres** — rate sheets, newsletters collapsed into a short list.
5. **Rendez-vous de demain** and **tâches dues** (existing data).
6. Footer — "Ouvrir dans Outlook" links per email, unsubscribe/settings link.

All emails of the day are included (full pagination, no 20 cap); counts shown are real totals.

## Controls
- Portal broker settings: on/off, send time(s), sections to include. Marc enabled first for testing, then all brokers opt in.
- AVA: "Envoie-moi mon résumé de courriels" triggers the same template immediately (one tool, no free-text email composing), with the usual confirmation.

## Rules kept
- Broker sees only his own mailbox; nothing sent to anyone else.
- AI only summarizes/classifies; counts and lists come from the actual mailbox read.
- If the mailbox read fails, no partial "summary" is sent — the broker gets a short failure notice instead.
- One send per broker per slot (no duplicates on retry).
- AVA protection tests stay green; new tests added.

## Technical details
- New shared builder `_shared/email-digest.ts`: Graph `/me/messages` with `$filter receivedDateTime ge startOfLocalDay` + `@odata.nextLink` paging; classify via AI gateway (batched, JSON schema output: priority/category/summary/action); deterministic HTML template (inline CSS, table layout, Outlook-safe, French).
- Send via existing `ms365-actions` sendMail to the broker's own address (server-side, service-role with `_user_id`), idempotency key `digest:<profile>:<date>:<slot>`.
- Extend `ava-daily-digest-scheduler` (already cron-triggered every 15 min) with the email-digest slot; store `last_email_digest_at` per slot on profile metadata.
- AVA tool `send_email_digest` added to shared registry + ElevenLabs tool list (94 tools), routed through `ava-tool-executor`.
- Settings UI in broker portal settings (and mobile settings mirror later, no native change).
- Tests: pagination totals, idempotency, failure → no digest, template contains all sections, ownership.

## Open questions (defaults used if no answer)
- Send time: morning 7:30, end of day 17:00, or both? (default: 17:00)
- Rollout: Marc only first, then everyone? (default: yes)
