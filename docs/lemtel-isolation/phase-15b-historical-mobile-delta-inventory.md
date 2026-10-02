# Lemtel — Phase 15B: Historical Mobile Delta Inventory (review only)

Status: read-only inventory. No application code was copied, moved, deleted, regenerated or modified. No build, deployment, package installation, PBX connection or secret access occurred.

## Sources compared

| Label | Source | Files |
| --- | --- | --- |
| Current (C) | this repository, `apps/ava-softphone-mobile/` | 280 (excluding dependencies) |
| Historical A | `AssistantVirtualAI/attach-app-creator`, `main`, `apps/ava-softphone-mobile/` (uploaded archive) | 264 |
| Historical B | `AssistantVirtualAI/attach-app-creator-dd351dc5`, `Planipret`, `apps/ava-softphone-mobile/` (uploaded archive) | 264 |

Historical archives were extracted to a temporary directory outside the repository and inspected there only.

A and B differ in exactly one file: `android/app/src/main/java/com/lemtel/softphone/CapacitorPjsip.kt`. In B it is a 155-line stub without the PJSUA2 engine; in A it is a 401-line PJSUA2 wrapper. B is therefore an earlier, less complete copy of A and adds nothing that A lacks.

## 1. Current app identity

- Capacitor: `appId: 'com.lemtel.softphone'`, `appName: 'Lemtel Softphone'`.
- Android: `applicationId "com.lemtel.softphone"`, `versionCode 112`, `versionName "1.0.21"`, `app_name` = Lemtel Softphone.
- iOS: `PRODUCT_BUNDLE_IDENTIFIER = com.lemtel.softphone`, `MARKETING_VERSION = 1.0.21`.

## 2. Historical identity and why it is not a migration target

- Historical A/B Capacitor: `appId: 'com.assistantvirtualai.softphone'`, `appName: 'AVA Softphone'`; Android display name AVA Softphone; Android `versionCode 16` / `1.0.3`; iOS `MARKETING_VERSION = 1.0.2`.
- The native store identifiers were already `com.lemtel.softphone`, so the AVA Capacitor identity conflicts with the published Lemtel identity. Store versions are far older than the current published line (112 / 1.0.21); restoring them would be a downgrade the stores reject.
- Conclusion: the historical AVA identity is HISTORICAL_OBSOLETE_DO_NOT_PORT.

## 3–4. Categorized deltas

| Area | Finding | Category |
| --- | --- | --- |
| Store identity | C uses Lemtel Softphone / com.lemtel.softphone consistently; A/B mix AVA naming with Lemtel bundle IDs and older versions. Launcher icons and `ic_launcher_background.xml` differ (C = Lemtel branding). | CURRENT_SUPERSEDES_HISTORICAL |
| SIP registration | C dispatches iOS → native PJSIP (`useSoftphoneNative`), Android and web → JsSIP over WSS (`useSoftphone.ts`). C adds `iceServers.ts`, `androidRegisterConfig.test.ts`, `formatSipParty.ts`, updated `jssipProvider.ts` and `nativeAutoReconnect.ts`. | CURRENT_SUPERSEDES_HISTORICAL |
| Incoming call UI | `IncomingCallSheet.tsx`, `ActiveCallSheet.tsx` changed in C; C adds `androidCallNotif.ts`, `CallActionReceiver.kt` (answer/decline from the notification). | CURRENT_SUPERSEDES_HISTORICAL |
| Android foreground/background | A: separate `SipForegroundService.kt` (74 lines) + 34-line `SipConnectionService.kt`, `foregroundServiceType="microphone|phoneCall"`, `BIND_TELECOM_CONNECTION_SERVICE`. C: consolidated 1218-line `SipConnectionService.kt`, `BootReceiver.kt`, `AudioFocusHelper.kt`, `MainActivity.kt`, `foregroundServiceType="phoneCall"`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `CHANGE_WIFI_STATE`. | CURRENT_SUPERSEDES_HISTORICAL (one item below for review) |
| Android foreground service type | A declared `microphone|phoneCall`; C declares `phoneCall` only. On Android 14+, mic capture while backgrounded during a call can require the `microphone` type. | CANDIDATE_FOR_TARGETED_REVIEW |
| iOS CallKit / push | Same structure in A and C: `PKPushRegistry` in `AppDelegate.swift`, `CallKitManager.swift`, one `aps-environment`, background modes `audio` + `remote-notification`. C edits `AppDelegate.swift`, `CallKitManager.swift`, `CapacitorSip.swift`, `Info.plist`, `App.entitlements`. | CURRENT_SUPERSEDES_HISTORICAL |
| Credential loading | Both use `creds.ts` and `mobileApi.ts`; C adds `useMobileCredentials.ts` (server-issued, user-scoped credentials). | CURRENT_SUPERSEDES_HISTORICAL |
| CDR / recordings / voicemail | Same screen set in A and C (`CallsScreen`, `CallDetailScreen`, `RecordingsScreen`, `VoicemailScreen`, `InboxScreen`); C has 32 screens vs 31. Privacy (own extension only) must be re-proved in Phase 18, not inferred from history. | CURRENT_SUPERSEDES_HISTORICAL |
| Native plugins | A bundles a local `capacitor-pjsip/` package (iOS plugin, podspec) and a full PJSUA2 Android wrapper; B only a stub. C has `CapacitorPjsip.kt` (469 lines) and `android/app/src/main/jniLibs/`. | CURRENT_SUPERSEDES_HISTORICAL |
| Historical local `capacitor-pjsip/` package | Superseded by the in-tree plugin of C. | HISTORICAL_OBSOLETE_DO_NOT_PORT |
| Historical B PJSIP stub | Incomplete; never a source. | HISTORICAL_OBSOLETE_DO_NOT_PORT |
| Diagnostics | C adds `SipDebugPanel.tsx` and Android branches in `AudioDiagnosticsScreen.tsx`; A only had the iOS 440 Hz tone test. | CURRENT_SUPERSEDES_HISTORICAL |
| Verto | Neither history nor policy supports Verto. C still contains `vertoProvider.ts`, `vertoProvider.test.ts`, `useSoftphoneVerto.ts`; `useSoftphone.ts` imports `useSoftphoneVerto` but never dispatches to it (Android was moved to JsSIP/WSS). Not a historical delta to port; recorded as a current-code finding. | CANDIDATE_FOR_TARGETED_REVIEW |
| Environment files | C contains local environment files; values were not read. A/B contain none. | Not a delta to port |

## 5. Candidates for targeted review

### 5.1 Android foreground service type `microphone`

- Current file: `apps/ava-softphone-mobile/android/app/src/main/AndroidManifest.xml` (`foregroundServiceType="phoneCall"`).
- Historical file: Historical A `android/app/src/main/AndroidManifest.xml` (`microphone|phoneCall`).
- User benefit: possible prevention of silent outgoing audio when the app is backgrounded or the screen is locked during a call on Android 14+.
- Risk: Play Store policy declaration for the microphone service type; incorrect `startForeground` type arguments cause a crash at service start.
- Required regression tests: inbound and outbound calls with screen locked and app backgrounded on Android 13, 14 and 15; two-way audio for 60 s; answer from notification; Play Console foreground-service declaration review.
- Why manual: the consolidated C service starts its foreground notification differently from A; the manifest line cannot be copied without matching code in `SipConnectionService.kt`.

### 5.2 Dormant Verto code in the current app

- Current files: `src/lib/sip/vertoProvider.ts`, `src/lib/sip/vertoProvider.test.ts`, `src/hooks/useSoftphoneVerto.ts`, import in `src/hooks/useSoftphone.ts`.
- Historical file: none (not present in A or B).
- User benefit: removes a reactivation path forbidden by program rule 5 and reduces bundle size.
- Risk: removing shared types used by other screens (`DialerScreen.tsx`, `audioOutput.ts`, `iceServers.ts` mention Verto).
- Required regression tests: full Android and iOS call matrix (register, inbound, outbound, hold, transfer, DTMF, hangup), web build, existing unit tests.
- Why manual: removal touches the current call dispatcher and must be its own approved Lemtel mobile phase, never part of a review-only phase.

## 6. Conclusion

The current app remains authoritative. No historical source is copied. Historical B is an incomplete subset of A, and A's AVA identity is obsolete. Only two items warrant a future, separately approved, targeted manual review; both are listed above with their tests.
