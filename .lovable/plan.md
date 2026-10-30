# AVA texting for Marc — make it actually reply

## What's wrong today (checked)
- The phone system is not sending us any text alerts: the alert receiver has zero activity in its logs, so instant alerts never arrive.
- The 30-minute background sync never reaches the part that imports Marc's texts. It spends its time on recordings, and the "AVA pilot import" line never shows up in the logs. Result: "Bonsoir Marc" (04:53) was never saved, so AVA never saw it.
- AVA's replies have no signature.

## What I'll build
1. **Dedicated 1-minute check, Marc only** (you approved this). A small, separate job reads only Marc's recent conversations straight from the phone system, the same way the portal does (which is why the portal shows texts almost instantly). New incoming texts get saved and handed to AVA. It does nothing when the test is off, and it never touches other brokers.
2. **Phone system alerts as the first path.** Check which alert subscriptions really exist and add the "conversation updated" alert type next to "message". If alerts start arriving, AVA reacts instantly. The 1-minute check stays as the safety net.
3. **Portal/app trigger.** When Marc's portal or app loads his texts and sees a new incoming one, it asks the server to process it right away. The server re-reads the text from the phone system itself and never trusts what the screen sends.
4. **Exactly one reply per text.** Each incoming text is claimed once (this protection already exists). The same text arriving through all three paths still gets a single answer.
5. **Full conversation analysis.** AVA reads the whole thread with that person (DID and extension together, a different cell number kept separate), then answers.
6. **Signature.** Every AVA text ends with "— AVA, assistante de Marc Maglieri". The server adds it, so the AI can't forget or change it.
7. **Security stays as built.**
   - External numbers: greetings and general questions only. No rates, files, commissions or personal info. Sensitive requests go to Marc for approval.
   - Internal extensions: ordinary replies only. A matching colleague number never unlocks private tools.
   - No automatic resend if a send result is uncertain. Ever.
8. **Catch up "Bonsoir Marc".** The first run imports it and AVA replies to it once.

## Verification
- Tests for: signature always present, one reply per text across all three paths, external vs internal rules, ignored when the test is off, other brokers never processed.
- All AVA protection tests stay green.
- Live check: "Bonsoir Marc" gets saved, AVA sends one signed reply, and the job record shows it as accepted. "Accepted" isn't proof of delivery, so you confirm on your phone.

## Technical details
- New server-only function `pp-ava-sms-watch`: reads `/domains/planipret.ca/users/1136/messagesessions` and messages updated since `activated_at`, upserts with `inboundSmsRow` on `ns_message_id`, and calls `pp-ava-sms` `process` for each new inbound row. Runs single-flight with a short lease row so overlapping runs skip.
- A pg_cron job runs it every minute. It returns right away when `planipret_ava_sms_pilot.enabled` is false.
- `pp-ava-sms`: new `watch_now` action (Marc's JWT only) that runs the same watcher. Signature is appended in `dispatch` before `pp-ns-sms` send, and the length budget is reduced to fit it.
- `ns-webhook-setup` models: add `messagesession`. The receiver maps it to a watcher run for verified Marc only. Read the current subscription list before changing anything.
- Remove the pilot block from `pp-admin-ns-sync` so there is one import path.
- Files: `pp-ava-sms`, new `pp-ava-sms-watch`, `ns-webhook-receiver`, `ns-webhook-setup/models.ts`, `pp-admin-ns-sync`, `PBMessages.tsx` (watch_now call), tests in `src/test/avaSmsPilot.test.ts`.
- Deploy only those functions. I won't publish the portal unless you ask.
