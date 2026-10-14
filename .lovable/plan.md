# AVA chat and AVA voice switches per user

## What you will get
- In the admin portal user list, two switches next to each user: **AVA Chat** and **AVA Voice**. Plus bulk "enable / disable" buttons for the selected users.
- The mobile app reads these switches live:
  - On: the user can use AVA chat or AVA voice as usual.
  - Off: the AVA screen shows a message such as "AVA Chat (or AVA Voice) is not enabled on your account. Contact your administrator to activate this feature." (FR/EN).
- Changes apply right away. The app refreshes when an admin flips a switch, without a restart.
- The server enforces it too: a user with a switch off is refused by AVA chat or voice even with an older app.

## Current state
- AVA Voice already has its own switch in the list (`voice_agent_enabled`). It will be relabelled "AVA Voice" and kept.
- AVA Chat has no switch today. A new one will be added, **on by default** for all existing users so nobody loses access.

## Technical details
- Migration: `planipret_profiles.ava_chat_enabled boolean NOT NULL DEFAULT true`. Added to the safe profile column lists in both web source trees.
- `PAUsers.tsx`: new column with `Toggle` that goes through `toggleField` (extended to `ava_chat_enabled`), bulk actions, filter. `pp-admin-user` update allow-list includes `ava_chat_enabled`.
- Mobile (`src` and `apps/planipret-mobile/src`): `MAvaChat.tsx`, AVA entry points in `MHome`/`MMore`, and the voice agent read both flags. Locked screen with the "contact your admin" message. Realtime subscription on the user's own profile row so changes show up immediately.
- Server enforcement: the AVA chat function and `pp-ava-webrtc-token` (voice) return 403 `ava_chat_disabled` / `ava_voice_disabled` when the flag is off; the app shows the same message.
- No native iOS/Android changes. Portal and server parts are live right away; the new mobile screens arrive with the next app version (the server refusal works on the current app).
