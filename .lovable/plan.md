# Megan voicemail/calls + notification badge "1" + alerts for all brokers

## Known (from previous read-only audit)
- Badge "1": every iPhone alert sends a fixed badge of 1; nothing resets it when notifications are cleared or the app opens.
- Megan: extension connected, recent alerts accepted by Apple, but receipt and voicemail audio not confirmed; no voicemail saved in the app.
- All brokers: 32/81 have no notification registration; email alerts enabled for only 15/81 (not Megan).

## Plan
1. **Megan voicemail (read-only first)**: check her voicemail box on the phone service (new messages, forwarding rule, voicemail-to-app webhook), and whether webhook events for her extension reach our server. Fix only the server mapping if a gap is found; no routing changes.
2. **Megan calls**: review her recent call records and registrations (M mobile line) to identify drops/missed rings; report cause, no native code change without your approval.
3. **Badge "1" (server)**: replace fixed badge with the broker's real unread count (unread SMS + missed calls + new voicemails + due tasks), and send 0 when nothing is unread.
4. **Badge reset (app)**: clear the badge when the app opens or alerts are read. This touches the app itself, so it needs your approval and a new mobile version.
5. **Alerts for all brokers**: verify voicemail, SMS, missed call, task due and email triggers each send a push; enable email alerts by default only if you confirm; list the 32 brokers who must open the app once to register.
6. Tests for badge count rule; deploy server changes only after your approval; nothing published.

## Blockers
- Real-phone confirmation needs the updated app installed.
- Android alerts still depend on the Firebase key being configured.
