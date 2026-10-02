# Lemtel — Phase 18B-1: Dormant Android Verto stack removed

**Starting commit:** `8f444cbee` (branch `Planipret`). Source and tests only; nothing published, built for stores, or connected.

## Active path (unchanged)
Portal / `softphone-credentials` → Android WebView → JsSIP → credential-provided WSS (:7443) → FusionPBX.
The Android foreground helper only holds WakeLock/WifiLock, shows call notifications and relays notification actions to JS.

## Removed
- `src/hooks/useSoftphoneVerto.ts`, `src/lib/sip/vertoProvider.ts`, and its test `src/lib/sip/vertoProvider.test.ts` (could not exist without the module).
- `android/.../BootReceiver.kt`, its manifest receiver and `RECEIVE_BOOT_COMPLETED`.
- `SipConnectionService.kt` rewritten: no socket, TLS, JSON-RPC, executor, reconnect, credentials, SDP, call IDs, Verto actions or mode switch. Emits only `idle` / `running` (`foreground_helper_started`) / `stopped`. `START_NOT_STICKY`. `onTaskRemoved` stops the helper. Persistent notification: "Lemtel Softphone — Background call support active". Legacy prefs file is cleared without being read.
- `CapacitorPjsip.kt`: removed `answerNativeCall`, `hangupNativeCall`, `registerOutboundCall`, the Verto message relay and Verto-only status fields. `startSipService` takes no input. Added `beginCallAudio` / `endCallAudio` (audio focus + mode only, safe to repeat).
- `MainActivity.kt`: removed the native invite re-emit; still shows over the lock screen.
- `MobileApp.tsx`: removed the cold-start native status restoration (it could show an Answer UI without a JsSIP session).
- `nativeSipProvider.ts`: `startAndroidSipService()` sends `{}` only; Verto bridge helpers removed; added `beginAndroidCallAudio` / `endAndroidCallAudio`; status type is service health only (`loggedIn` kept solely for the shared iOS snapshot).
- `jssipProvider.ts`: `vertoHost` / `vertoPort` removed from `SIPConfig`.
- Stale Verto comments/log labels in `DialerScreen.tsx`, `SipDebugScreen.tsx`, `audioOutput.ts`, `CallActionReceiver.kt`; debug screen no longer shows login/ping/attempt fields.

## Audio lifecycle (JsSIP hook)
`beginAndroidCallAudio()` before Android `ua.call()` and before `session.answer()`; `endAndroidCallAudio()` on manual hangup, `ended`, `failed`, initial call exception, and unmount with an active session. Speaker is never enabled by default. SIP answer/hangup remain `session.answer()` / `session.terminate()` only.

## Preserved
Foreground service type `phoneCall`, notifications, microphone/contacts permissions, locked-screen incoming calls, manual speaker, portal credentials, `softphone-sync-password` recovery, direct SIP/WSS route, own-extension-only call data. No Planiprêt path, iOS, desktop, server, PBX, VPS or store change.

## Documented deviations
- `src/lib/sip/vertoProvider.test.ts` deleted (imports a deleted module).
- `src/lib/sip/iceServers.ts`: one stale comment edited ("migrated from Verto" removed); no code change.

## Validation
```bash
node scripts/verify-lemtel-planipret-isolation.mjs
npx vitest run src/test/lemtelMobileVertoRuntimePhase18.test.ts src/test/lemtelMobileAndroidVertoRemovalPhase18.test.ts
cd apps/ava-softphone-mobile && npx vitest run src/hooks/useSoftphone.runtime.test.tsx
git diff --check
```
Mobile build and `./gradlew :app:assembleDebug` could not run here (missing `@vitejs/plugin-react`; no Java/Gradle). No device, PBX or store test occurred.

## Remaining limitation
JsSIP registration lives in the WebView: it works while the app process survives in background, but no SIP call can be received after force-stop or reboot. The fix is the later Push + Lemtel Edge work, not a native SIP stack.
