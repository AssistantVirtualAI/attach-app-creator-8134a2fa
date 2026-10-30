# Daily summary email for all brokers

## What brokers get
Every business day at the time they choose, one email sent to their own address only. It covers:

1. **Header**: date and the broker's name.
2. **Stats at a glance**: calls answered or not answered, missed calls, voicemails, texts received and sent, emails received, and how many emails need action.
3. **Charts** (drawn into the email itself, readable in Outlook and on phones):
   - calls by hour (bars)
   - answered vs. missed (bar split into two parts)
   - texts and emails compared with yesterday (small arrows)
4. **Missed and unanswered calls**: who called, when, and whether they left a voicemail.
5. **Voicemails**: caller (directory name or number), time, length, and a short summary when a transcript exists.
6. **Texts**: conversations from today with no reply yet first, then the rest.
7. **Emails**: every email from today. Each gets a **one-line AI summary** and a suggested action, grouped into "À traiter", "Clients et partenaires" and "Infolettres".
8. **Tomorrow's appointments** and **tasks due**.
9. **Footer**: link to the settings page, and a note that the email is sent only to the broker.

## Settings (portal and mobile app screens, no app release needed)
- In broker Settings, a "Résumé quotidien par courriel" card with:
  - an on/off switch
  - the send time (between 6:00 and 21:00, every 30 minutes)
  - optional sections (calls, voicemails, texts, emails, appointments)
  - a "M'envoyer un exemple maintenant" button
- Default for **all brokers**: on, at 17:00. Each broker can turn it off.

## Test email to you
- Send one real example to your address (mhassoun@assistantvirtualai.com), built from your own data.
- Send one example built from Marc's data to Marc only, so you can review it on his account. It is never sent to anyone else.

## Safeguards
- Each broker sees only their own calls, voicemails, texts and emails.
- Counts come from the actual data. The AI only writes the one-line summaries. If the AI fails, the email still goes out with the start of each email instead.
- One email per broker per day. If an earlier step fails, no partial summary is sent; the broker gets an app alert instead.
- Brokers with no Microsoft 365 connection still get the email, with no email section.
- AVA tests stay green.

## Technical details
- `_shared/email-digest.ts`: add `buildDailyReportHtml` (table-based HTML with inline styles; charts built from table cells, no images) and pure stat aggregation functions, with tests.
- Data sources: `planipret_phone_calls` (by broker, local day), mirrored voicemails, `planipret_phone_messages` (unanswered texts = threads whose last message is incoming), Microsoft 365 inbox read with paging, calendar for tomorrow, and the Maestro tasks already used by AVA.
- One-line summaries: one batched AI gateway call per broker (default model, strict JSON output). A failure falls back to the start of each email and never blocks the send.
- Sending: through the broker's own Microsoft 365 to their own address. Without Microsoft 365, through the project's email service from a fixed sender to the broker's profile email (this needs the email domain set up; checked first, otherwise those brokers are skipped and listed).
- Scheduler (`ava-daily-digest-scheduler`, existing 15-minute job): every broker who has it turned on, at their own time, marked sent before sending so a rerun never sends twice. Turning it on for everyone is a one-time data update after approval.
- Settings stored in profile `metadata` (`email_digest_enabled`, `email_digest_time`, `email_digest_sections`), in the `PBSettings.tsx` and `MMore.tsx` screens.
- New action `daily_report` (with `preview_only` and `send_test`); the AVA path `summarize_inbox send_by_email` reuses it.
