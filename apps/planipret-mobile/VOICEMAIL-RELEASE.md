# Voicemail release candidate — 2026-10-21

## Scope
Paired mobile web changes only: voicemail caller names/numbers, empty-field fallback, account/tab reset, fresh owner-checked audio URLs, stale request cancellation, playback error handling. No Swift, Android, PJSIP, CallKit, PushKit, FCM, DID, routing, subscription, secret or native-test changes.

## Deployed server
Only `pp-ns-voicemail`: documented `new/save/trash` reads; individual metadata enrichment for unidentified messages; own-folder filename membership before audio read; profile-owned non-destructive persistence that retains prior caller identity.

## Evidence
- 84 profiles, 81 linked accounts, no missing telephone scope, no duplicated extension/domain scopes. This establishes configuration coverage, not successful retrieval for all brokers.
- Voicemail RLS enabled: broker profile ownership enforced; intentional existing Planiprêt admin exception retained. The mobile endpoint always uses the authenticated broker's own extension, not client-selected identities.
- Requester: inbox HTTP 200, nine items, saved HTTP 200, zero items, no synchronization failure. Absent filename audio denied HTTP 404. A real message audio read and download returned HTTP 200, WAV 3,244 bytes.
- Server read/normalization: 11 tests passed; portal 12 tests and mobile 12 tests passed. Same page and merge helpers in both trees. Preview build OK; no independent mobile production build, signed artifact, install, upload or store submission performed.
- Contact/internal/number fallback fixtures pass. The requester's nine historical messages return no caller number/name even after individual metadata reads; they remain unknown. Do not infer callers from nearby calls or invent numbers.

## Release handoff
Use the current validated native candidate as the baseline. Include only the paired `MVoicemail.tsx`, `voicemailList.ts` and `voicemailList.test.ts` changes from this lot, retaining MMore differences and all protected native fixes. Do not copy entire trees or run scripts to rewrite protected configuration.

On the release workstation: first git pull the approved project. Obtain fresh portal/mobile TypeScript and production build results, using the project's gates and ensuring automatic native sync is disabled during web-only verification (`PP_SKIP_AUTOSYNC=1`). Review the native candidate's version/signing independently; no version bump is supplied by this lot. Then run `npx cap sync` for the approved platform on that workstation, inspect its diff, and build/sign with existing Xcode/Android Studio configuration. Stop if protected settings or telephony sources change unexpectedly. No real iOS signed release is possible in this Linux sandbox.

## Real-phone acceptance — required before claiming all brokers fixed
1. Install the signed candidate on iPhone and Android; sign in as broker A with an existing mailbox. Refresh Inbox and Saved and play a nonempty message; confirm audible sound, pause/resume and no stuck playback.
2. Repeat with broker B's own account; A's message names, rows and playback must disappear on sign-out. Submit A's test message filename through B's session: expect no access unless B independently owns a message with that same filename. Do not share live signed URLs.
3. Obtain a consented fresh external voicemail from a phone contact after granting Contacts permission/sync; show its name and number. Phone contacts require existing permission and successful account-scoped sync.
4. Repeat with an internal broker extension and with an unsaved external number. Expect internal directory name or formatted external number. A withheld/absent caller may remain unknown.
5. Switch folders and messages during a slow audio load: no stale audio can start. Expired media/network/playback failures must not falsely show playing.
6. Roll out to all 81 linked brokers and record per-account inbox, saved, own-message playback and isolation outcomes; three profiles without linked accounts need account provisioning outside this lot. No bulk sign-in or impersonation was performed.
7. Screen notification delivery, saved-message mutations and native call behavior are separate unverified paths, not established by these read tests. Do not alter routing to make this test pass.

For native release workflow context, read the existing mobile-development blog: https://lovable.dev/blog/mobile-app-development