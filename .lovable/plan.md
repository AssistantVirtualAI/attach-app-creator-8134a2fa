# AVA (chat and voice): full access to the mobile app

## Goal
AVA can read and act on everything a broker or admin can reach in the app: tasks, calls, texts, voicemail, emails, Teams, calendar, clients, contracts, commissions, client creation, and the Settings screen (More). She uses the same permissions as the person signed in. Sensitive actions (sending, deleting, creating) still need a spoken or written "yes" first.

## What AVA can already do
82 shared chat and voice tools already cover: calls (call, hang up, history, recordings, transcripts), texts (send, conversations), voicemail (list, greeting), tasks (list, create, edit, complete, reschedule, delete), appointments, clients (search, profile, contracts, history, create, edit, Maestro notes), commissions (paid and pending, team, any broker for admins), emails (read, summarize, send, draft reply), calendar (read, create, move, cancel), Teams (list chats, create a chat, send), directory, stats, daily briefing, and screen navigation.

## Gaps to close
1. **Settings (More screen)**: new tools to read and change Do Not Disturb, notifications, dark mode, language, ringtone, call audio, the voice assistant on/off, and AVA customization. AVA can also open Profile, Password, Extension, Connections, Privacy and Diagnostics. AVA never changes the password, the AI consent or privacy settings herself. She opens those screens instead.
2. **Teams**: read a chat's messages and reply in a thread (today AVA can only send).
3. **Texts and emails**: read a full text conversation; reply to or forward an email.
4. **Voicemail**: mark as heard, delete (with confirmation), and transcribe.
5. **Calls**: transfer, hold/resume, and set call forwarding (with confirmation).
6. **Clients and contracts**: read contract details (rate, renewal date, lender) and run search filters (renewals coming up, status).
7. **Navigation**: `navigate_to` covers every mobile page (commissions, charts, pipeline, clients 360, by-broker views, Maestro, connections, diagnostics).
8. **Chat and voice parity**: every tool is available identically in chat and in voice, with an automatic test that fails if the two lists differ.

## Rules kept
- Same scope as the signed-in user. A broker never sees other brokers' data except their own team's commissions. Admins see what the portal lets them see.
- Sending, deleting, creating and changing settings all need confirmation. Nothing is sent to the CRM without an explicit request.
- Client lookups show the profile first. Calls, texts and emails only happen when asked.
- No native iOS/Android code changes and no partial release. The server-side updates and the app update ship together.

## Verification
- Automatic tests for each new tool, plus the chat/voice parity check.
- Tests with the admin account in chat and voice, covering one read and one confirmed action in each area. A broker account will be tested if you approve signing in as one.
- Brokers will see new Settings controls only after the next app update. Server-side abilities work right away.

## Technical details
- Tools are declared in `_shared/ava-tools.ts` and run in `ava-tool-executor`, reusing existing functions (Maestro, MS365 Graph, NetSapiens, `planipret_settings.preferences`).
- Settings changes made by AVA come back to the app through a `settings_changed` event, so the screen updates right away.
- The tool count in the `avaToolsContract` test gets updated.
