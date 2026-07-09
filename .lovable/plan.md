## Goal
Add step-by-step, crash-resilient logging around the post-login permission flow on Android so we can pinpoint the exact line that crashes the Lemtel Softphone app after login.

## Changes

### 1. Rewrite `apps/ava-softphone-mobile/src/lib/requestPermissionsAfterLogin.ts`
Replace entire file with an instrumented version:
- `log(step, data?)` helper: writes to `console.log` AND appends to `@capacitor/preferences` key `perm_log` (trimmed to last 5000 chars) so logs survive a native crash/restart.
- `requestPermissionsAfterLogin()`:
  - Bump idempotency flag to `permissions_requested_v2` (so old installs re-run once with logging).
  - Wrap every single `await` in its own `try/catch` — never throws.
  - Steps: START → CHECK v2 flag → STEP A import `@capacitor/push-notifications` → STEP B add `registration` + `registrationError` listeners → STEP C `checkPermissions()` → STEP D `requestPermissions()` + `register()` → STEP E microphone `getUserMedia` (iOS only) → STEP F `@capacitor-community/contacts` requestPermissions (iOS only) → SAVE flag.
  - Android skips microphone and contacts prompts (matches current behavior).
- Export new `getPermissionLogs(): Promise<string>` that reads the `perm_log` key.

### 2. Add hidden debug viewer in `apps/ava-softphone-mobile/src/screens/AuthScreen.tsx`
- Add a `tapCount` + `debugLogs` state.
- Attach `onClick` handler to the existing logo/header element: 5 taps loads `getPermissionLogs()` and displays them.
- Render a full-screen scrollable overlay (fixed, dark bg, `<pre>` with logs, Close button) when `debugLogs` is set. Purely presentational — no other logic touched.

## Not touched
- iOS native files (`CapacitorSip.swift`, `CallKitManager.swift`, `Main.storyboard`, `project.pbxproj`, `RTPAudioSession.swift`, `AppBridgeViewController.swift`).
- `MobileApp.tsx` call site remains `requestPermissionsAfterLogin()` — signature unchanged.
- No changes to `MainActivity.kt`, Gradle, or ProGuard.

## How to read the crash location after reproducing
1. Reinstall / relaunch app after crash.
2. On the login screen, tap the logo 5× → overlay shows the last `perm_log` entries.
3. The last logged `STEP X:` line before silence = the crashing call.
